# App Gallery 技术方案

日期：2026-11-17

状态：原始完整架构基线。2026-11-18 已开始实现首个功能切片，
当前实际范围以 README 为准；本文的多环境、多入口、迁移、导入导出、
监测及自动备份不代表已实现。

当前切片调整：按用户要求先做功能和可复制部署，不做迁移；
每应用先使用一个生产部署和一个 URL，标签暂存 JSON 数组。
UTC 为第一版唯一日期解释口径，日期精度标记为“约”。
API 现阶段一次返回私有小型目录，搜索与分页扩展留待后续。
数据层当前使用 Drizzle 表定义与 SQL 查询，迁移为审查后的手写 SQL。

## 1. 定位与边界

产品定位为“私有应用入口 + 部署资产台账”，而不是运维控制台。

第一版假设：

- 个人或小团队使用，所有授权访问者均为管理员。
- 一个 Cloudflare 账户管理部署，默认不公开应用目录。
- 一个应用可以包含多个部署环境，一个环境可以有多个访问入口。
- 不采集或保管被管理系统的密码、Token、数据库连接凭据。
- 不引入多租户、复杂角色权限、容器管理、自动发布和自动服务发现。

## 2. 技术选型

| 层次 | 第一版选择 | 说明 |
| --- | --- | --- |
| 前端 | React + Vite + TypeScript | SPA，不要求 SEO 或服务端渲染 |
| 样式 | 普通 CSS + CSS Variables | 组件级组织，视觉设计后续单独确定 |
| 基础组件 | Radix UI Primitives | 弹窗、确认框、选择器、滑块、复选框和 Tooltip，自定义外观 |
| 图标 | Radix Icons | 统一在 `src/web/icons.tsx` 管理，应用图标支持中文名称 |
| 后端 | Cloudflare Workers + Hono | 同域 `/api/*`，轻量路由和中间件 |
| 请求校验 | Zod | 校验 API 输入和导入文件 |
| 数据访问 | Drizzle ORM，D1 适配器 | 表结构、类型和 SQL 迁移管理 |
| 数据库 | Cloudflare D1 | 通过 Worker binding 访问，不使用本地持久文件 |
| 身份保护 | Cloudflare Access | 邮箱白名单或已有身份提供方 |
| 发布工具 | Wrangler + Cloudflare Vite plugin | 本地开发、预览和生产发布 |
| 测试 | Vitest + Workers 测试环境、Playwright | 业务规则、D1 集成和页面流程 |
| 包管理 | pnpm | 锁定依赖，具体版本在初始化时确定 |

第一版不需要 Next.js、Docker、独立 Node.js 服务、Redis 或消息队列。
R2、Cron Triggers 和站点探测均为后续可选扩展。

Cloudflare 支持 React SPA 与 Workers API 的同项目部署；Drizzle 提供
D1 适配器。参考资料见文末。

## 3. 运行架构

```text
浏览器
  |
  | HTTPS
  v
Cloudflare Access
  |
  v
Workers + Static Assets
  |
  +-- React SPA
  |
  +-- /api/* -> 身份校验 -> 输入校验 -> 业务服务 -> D1

后续扩展：
  R2           图标和截图
  Cron Worker  公网健康探测
```

前端和 API 使用同一域名，不默认开放跨域访问。
`/api/*` 必须先进入 Worker，不能被 SPA fallback 返回成 HTML；
未知 API 返回 JSON 404，其他前端路径按 SPA 路由处理。

## 4. 数据模型

### 4.1 核心实体

| 表 | 主要字段 |
| --- | --- |
| `applications` | `id`、名称、描述、类型、别名、分类、图标标识、收藏、排序、归档时间 |
| `deployments` | `id`、`application_id`、环境、部署位置、生命周期状态、`revision` |
| `endpoints` | `id`、`deployment_id`、名称、URL、入口类型、是否主入口、排序 |
| `lifecycle_periods` | `id`、`deployment_id`、启用开始时间、结束时间、起止事件 ID |
| `events` | `id`、`deployment_id`、事件类型、发生时间、记录时间、时间精度、版本、备注、操作者 |
| `tags` | `id`、唯一名称 |
| `application_tags` | `application_id`、`tag_id`，联合唯一 |

通用记录包含创建和更新时间；ID 使用应用生成的 UUID。
类型字段使用枚举并在数据库和 API 层约束。
事件详情可使用有版本标识的 JSON，但常用查询字段必须独立存列。

应用类型：`website`、`service`、`app`。

部署环境预设 `production`、`staging`、`development`，允许自定义名称。
同一应用下的部署名称唯一，部署不等同于“发布一个新版本”。

入口类型预设：前台、后台、文档、API、仓库、下载。
第一版仅允许 `https:` 和 `http:` URL；原生 App 启动协议暂不支持。

### 4.2 约束与索引

- 使用外键约束，默认归档应用，不提供日常硬删除入口。
- 一个部署至多一个主入口、一个未结束的启用区间。
- 启用区间采用半开区间 `[start, end)`，结束时间不得早于开始时间。
- 同一部署的启用区间不得重叠；跨行约束由业务层和事务共同保证。
- 事件按 `deployment_id`、发生时间和确定性序号建立索引。
- 入口按 `deployment_id`、应用标签按关联 ID 建立索引。
- 第一版搜索名称、别名、描述、域名和标签，不引入独立搜索服务。
- 搜索接口分页返回，限制关键词长度和单页数量，使用参数化查询。

## 5. 生命周期与时间口径

### 5.1 状态机

```text
draft  --首次上线--> active
active --暂停-----> paused
paused --恢复-----> active
active --下线-----> retired
paused --下线-----> retired
```

第一版 `retired` 为终态。重新建立服务可新增部署，历史纠错走专用流程。
应用归档只影响目录展示，不隐式下线部署；归档时提示仍在启用的部署。

事件类型：

- `launched`：首次上线，开启启用区间。
- `paused`：暂停，关闭当前启用区间。
- `resumed`：恢复，开启新的启用区间。
- `retired`：下线，有未结束区间时关闭。
- `released`：发布版本，不重置首次上线日期。
- `migrated`：迁移，不自动改变启用状态。
- `note`：补充说明。

### 5.2 展示指标

| 指标 | 计算规则 |
| --- | --- |
| 首次上线 | 首次 `launched` 事件的发生时间 |
| 上线至今 | 首次上线到当前；已下线则到下线时刻，包含暂停阶段 |
| 累计启用时长 | 所有启用区间之和，未结束区间计算到当前时刻 |
| 最近发布 | 最近 `released` 事件的发生时间，可为空 |
| 连续观测在线 | 第一版不展示，后续根据探测记录单独定义 |

这些指标按部署计算；应用卡片默认展示生产部署，没有生产部署时展示
用户指定的主部署，不把多个环境的时长相加。

仅存储时间事实，不持久化不断变化的天数。服务端返回统一的 `as_of`
时间和计算结果，页面无需逐秒计时；跨日或重新打开页面时刷新。

### 5.3 时间精度与补录

- 精确时刻以 UTC epoch 毫秒存储。
- 展示时区通过 `APP_TIMEZONE` 配置，初始默认 UTC，上线时由管理员确认。
- 每个历史事件区分 `occurred_at` 和 `created_at`，支持补录。
- 只知道日期时，额外存储原始 `YYYY-MM-DD`、解释该日期的 IANA 时区及
  `precision=date`；按该时区当天起点归一化，界面标记时长为“约”。
- 精确事件使用 `precision=instant`，不人为补出未知时刻。
- 同时刻事件通过递增序号确定顺序，不依赖随机 UUID 排序。
- 第一版允许补录首次上线和按发生顺序录入的历史事件；不允许未来上线时间。
- 普通发布、迁移和备注可补录历史时间，但不能改变生命周期。
- 已存在后续生命周期事件时，不直接修改早期状态事件。
  任意回溯编辑和全量重建时间线不纳入第一版普通编辑界面。

### 5.4 写入一致性

状态、启用区间和事件必须在同一次原子批处理中提交。
采用 D1 的批处理机制，不假设传统连接式交互事务可用。

写请求携带唯一请求 ID 和期望 `revision`。
通过条件写入、数据库约束及受保护的关联写入实现并发控制；冲突必须整体
回滚或完全不写入，不能仅更新状态失败却继续新增事件。
重复请求返回既有结果，版本冲突返回 `409`。
具体 SQL 在实现阶段通过 D1 集成测试验证。

## 6. API 与代码结构

API 前缀统一为 `/api/v1`：

| 路由 | 用途 |
| --- | --- |
| `/applications` | 列表、搜索、创建 |
| `/applications/:id` | 详情、修改、归档 |
| `/applications/:id/deployments` | 新增和列出部署 |
| `/deployments/:id` | 修改部署资料，不直接修改生命周期状态 |
| `/deployments/:id/endpoints` | 管理访问入口 |
| `/deployments/:id/events` | 查询事件、创建非状态事件 |
| `/deployments/:id/transitions` | 执行上线、暂停、恢复、下线 |
| `/tags` | 标签维护 |
| `/export` | 导出版本化 JSON |
| `/import/validate` | 导入预检，不写入数据 |
| `/import` | 导入预检通过的完整数据 |

具体 HTTP 方法和错误码在实现时补全；不使用 GET 执行写操作。
导入格式包含 `schema_version`、导出时间和所有关联记录。
第一版只支持导入到空库，不做复杂合并；有任一非法记录时拒绝整个导入。
限制导入文件体积和记录数量，避免超出数据库及请求限制。

计划目录：

```text
src/
  web/                 页面、组件、样式、API client
  worker/
    index.ts           Worker 入口
    middleware/        身份、错误处理、请求日志
    routes/            HTTP 路由
    services/          生命周期、搜索、导入导出
    db/                schema、查询
  shared/              请求结构、枚举、校验
tests/
  unit/
  integration/
  e2e/
drizzle/               SQL 迁移
docs/
wrangler.jsonc
```

## 7. 安全与环境隔离

- Cloudflare Access 保护整个站点，授权邮箱范围保持最小。
- API 验证 `Cf-Access-Jwt-Assertion` 的签名、issuer、audience 和有效期，
  不信任单独传入的邮箱请求头。
- 关闭未受保护的 `workers.dev` 和预览访问入口，或配置等价保护；
  不允许绕过自定义域名直接访问数据 API。
- 本地身份模拟只允许在明确的本地配置启用，生产环境缺失认证配置时拒绝访问。
- 写接口校验 Origin，要求 JSON Content-Type，不启用宽泛 CORS。
- 私有 API 使用 `Cache-Control: no-store`，不写入公共 CDN 缓存。
- React 文本转义输出，不渲染任意 HTML；外链新窗口使用安全 rel 属性。
- 第一版不服务端抓取用户输入 URL，不自动下载远程图标，避免 SSRF。
- 日志记录请求 ID、耗时、结果，不记录身份令牌、完整导出内容或敏感查询参数。

本地、预览和生产使用不同 D1 数据库及 Access audience。
数据库 binding 固定为 `DB`；`ACCESS_TEAM_DOMAIN`、`ACCESS_AUD` 和
`APP_TIMEZONE` 为环境配置，部署凭据只放在 CI 或本地凭据存储。

## 8. 部署、迁移与恢复

部署顺序：

1. 创建生产 D1，配置正式域名和 Access 应用。
2. 配置 Worker bindings、环境变量和访问入口限制。
3. 在预览环境执行迁移、集成测试和权限验证。
4. 生产迁移前创建可恢复备份，迁移完成后发布应用。
5. 验证登录、未授权拒绝、应用查询和生命周期写入。

Wrangler 执行版本化 SQL 迁移；Drizzle 负责生成迁移，生成结果必须审查。
优先采用兼容旧版本代码的增量变更，不将生产手工改表作为常规流程。

D1 Time Travel 用于平台内恢复，保留窗口取决于计划，实施时确认。
另保留版本化 JSON 导出及 SQL 备份到独立位置；Time Travel 不替代独立备份。
第一版提供手动导出和备份操作说明，自动备份作为后续增强，
发布生产版本前必须演练一次导出与恢复。

暂不固定承诺零费用。上线时核对 Workers、D1 和 Access 的当期额度，
设置可用的用量通知并定期检查。业务逻辑不依赖进程常驻或本地磁盘。

## 9. 第一版验收

- 未授权用户无法读取页面内的私有数据或调用 API。
- 能创建应用、多个部署、多访问入口并搜索、收藏、归档。
- 能补录上线日期，录入发布和迁移记录。
- 暂停、恢复、下线后累计时长正确，发布事件不重置首次上线。
- 重复请求、并发状态操作不会产生重复事件或重叠区间。
- UTC、非 UTC、跨日和夏令时边界有测试；日期精度显示为约数。
- 未知 API 返回 JSON 404，页面深层链接可刷新访问。
- 导出后可以在空测试库恢复关联数据和历史时间。
- 桌面和移动端都能搜索、打开入口、查看历史。

## 10. 后续扩展

- R2 图标及截图上传，增加文件大小、类型和授权校验。
- 定时公网探测，探测目标限制、超时、重定向和私网地址检查单独设计。
- 私网服务默认标记“需要 VPN / 内网”，不将公网不可达直接判定为故障。
- 监测结果独立存储，不覆盖人工生命周期状态。
- 任意回溯纠错、时间线重建、只读角色和个人收藏。
- 自动备份和部署平台同步。

## 11. 官方参考

以下资料于 2026-11-17 核对；配置语法、套餐限制及版本在实现时再次确认。

- React + Vite 全栈部署：`https://developers.cloudflare.com/workers/framework-guides/web-apps/react/`
- 静态资源路由：`https://developers.cloudflare.com/workers/static-assets/binding/`
- Access JWT 校验：`https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/`
- Drizzle D1 适配器：`https://orm.drizzle.team/docs/sqlite/connect-cloudflare-d1`
- D1 恢复：`https://developers.cloudflare.com/d1/reference/time-travel/`
