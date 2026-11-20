# App Gallery

[English](README.md) | **简体中文**

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FOpenSlash%2Fapp-gallery)

用于管理已部署网站、基础服务和 App 的私有入口与应用资产台账。

核心目标：

- 搜索、分类和收藏应用，快速找到访问入口。
- 记录不同环境的上线时间、发布记录和生命周期。
- 展示上线至今及累计启用时长，不将其误标为实际在线时长。

## 已实现

- Apple Launchpad 风格首页、纯白背景、收藏 Dock。
- Radix UI 基础组件：弹窗、二次确认、选择器、滑块、复选框和 Tooltip；
  保留自定义视觉，支持键盘操作和焦点管理。
- 统一 Radix Icons，提供 16 种应用图标和中文提示。
- 启动台 / 卡片视图、整体缩放、上线天数开关。
- 单应用小 / 中 / 大尺寸，在卡片视图对应 1×1 / 2×1 / 2×2。
- 应用新增、编辑、搜索、分类、标签、类型筛选、排序、收藏。
- 首次上线日期补录，暂停、恢复、下线、发布和备注时间线。
- 下线或未上线应用归档；数据保留，首页隐藏。
- D1 数据持久化、API 校验、内置管理员密码登录与未配置时安全锁定。
- 仅允许添加应用的 API Token，支持到期时间、查看调用时间和撤销。

当前每个应用只管理一个生产部署、一个访问地址。多环境、多入口、
迁移、导入导出、在线监测及文件上传不在这一轮实现。
上线日期使用 UTC，所有“天数”均为台账时长，不是实际在线率。

## 本地开发

建议使用 Node.js 24 LTS 和 pnpm 10。不需要 Cloudflare 登录。

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

仅本地开发时，可在 `.dev.vars` 中添加 `LOCAL_DEV=true`，再执行：

```sh
pnpm db:local
pnpm dev
```

打开终端输出的本地地址。开发身份仅在 localhost / 127.0.0.1 生效。
不要将 `LOCAL_DEV=true` 添加到生产配置。
示例预览不写入数据库，新安装实例不会预置示例应用。
需要测试真实登录时，不设置 `LOCAL_DEV`，首次打开页面时设置管理员密码。
密码凭据保存在本地 D1，重启开发服务器不会丢失。

需要可以编辑、收藏和查看历史的持久化模拟数据时，执行：

```sh
pnpm seed:local
```

该命令仅操作本地 D1，添加 12 个带“模拟数据”标签的应用，包含三种尺寸、
四种生命周期状态、收藏和历史事件。入口统一指向 `example.com` 占位网址，
不是实际部署的服务。可重复执行，不覆盖已有编辑，也不会恢复已归档的数据；
它不包含在生产迁移或一键部署流程中。

```sh
pnpm check
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

本机已有 Google Chrome 时也可以执行
`PLAYWRIGHT_CHANNEL=chrome pnpm test:e2e`，无需下载测试浏览器。

端到端测试会操作本地 D1，测试应用在成功后归档。

## 一键部署

部署路径为 React + Vite + Cloudflare Workers + D1，不需要自备服务器。
`package.json` 已定义构建、建表和发布脚本，以及部署参数说明。
可使用文档顶部的 Deploy to Cloudflare 按钮创建自己的实例。

项目推送到公开 GitHub / GitLab 仓库后执行：

```sh
pnpm deploy:button https://github.com/OpenSlash/app-gallery
```

也可以在已设置 Git origin 后直接执行 `pnpm deploy:button`。
命令输出该仓库的 Deploy to Cloudflare 按钮 Markdown。
在 Cloudflare 部署页面使用构建命令 `pnpm build`，部署命令必须为
**`pnpm run deploy`**，不能只执行 `wrangler deploy`。
必须保留 `run`：`pnpm deploy` 会调用 pnpm 自带的工作区部署命令，
而不是本项目的发布脚本。
发布脚本会先查找配置名称对应的 D1，不存在时创建，再将真实 ID 写入
`wrangler.jsonc`，执行迁移，以零行查询检查必要表和字段，
并重新构建 Vite 产物后发布。
若构建产物的 ID 与实际绑定不一致，会终止发布。
Cloudflare 模板流程也可能提前创建数据库；已有真实 ID 时会保留。

**不再需要开通或配置 Cloudflare Zero Trust / Access。**

1. 完成部署，无需在部署表单或 Worker 设置中配置管理员密码或 Secret。
2. 立即打开 Worker 地址，在首次设置页面输入并确认 16 至 256 位的独立长密码，
   建议使用密码管理器生成；保存后使用该密码登录。
3. 确认未登录请求 `/api/v1/applications` 返回 401，再录入真实资料。

**首次初始化的归属风险：**设置完成前，任何能够访问本站的人都可以抢先创建
管理员密码。请勿提前分享网址，敏感部署建议在初始化期间临时限制访问。
首次设置页面不验证访问者是否为 Cloudflare 账号所有者。

D1 只存 PBKDF2-SHA-256 密码哈希（100,000 次迭代）、每个密码独立的随机盐、
以及独立的会话签名密钥，不存明文密码。数据库单例主键保证并发或重复初始化
不能覆盖已有密码。初始化完成前，数据接口返回 503。请妥善备份和保护 D1。

会话有效期 12 小时，HTTPS 下使用仅限当前主机的 HttpOnly、Secure、
SameSite=Strict Cookie。D1 只存令牌哈希和绑定当前密码的校验值；
退出会撤销服务端会话。初始化后不再开放注册，也没有网页找回密码入口。
设置与登录共用按 IP 和 Cloudflare 节点每分钟 5 次的限流，不是全局严格配额。
页面外壳不包含业务数据，动态预览 URL 默认关闭。

### 命令行部署

不使用部署按钮时，先登录，再执行完整部署：

```sh
pnpm exec wrangler login
pnpm run deploy
```

生产账号资源和真实云端发布尚未在本仓库执行。
如需其他数据库名称，在首次部署前修改 `wrangler.jsonc` 中的 `database_name`；
如需使用指定数据库，直接填入其真实 `database_id`。命令行部署会将解析到的
真实 ID 写入配置，建议在自己的部署仓库中保留该 ID。
部署后打开网址设置管理员密码；设置完成前数据接口保持锁定。

### D1 错误 10181 恢复

若报错中的数据库 ID 为 `00000000-0000-0000-0000-000000000000`，
说明仍在使用旧模板或旧构建。先更新 Cloudflare 实际关联的仓库；
若一键部署复制了一份仓库到你的账号，需要同步那份副本，不能只更新上游。

在 Workers Builds 设置中确认部署命令为 `pnpm run deploy`，然后从最新提交
启动一次全新构建。不要只重试旧产物，也不要仅在后台添加绑定却保留源码的假 ID。
新版脚本会根据配置名称修复旧版全零 ID，不会自动替换非占位 ID，也不会删除数据库。

### 旧版本升级

将更新拉取到你的部署仓库，执行 `pnpm build` 和 `pnpm run deploy`，
后者会应用新增的会话及凭据表迁移，再打开页面设置密码。
确认密码登录正常后，可移除旧 Access 应用或 Worker 保护，避免额外登录。
`ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 不再使用，已有应用及历史数据保留。

### 已有 Secret 登录的实例

没有 D1 密码时，有效的运行时 `ADMIN_PASSWORD` 仍可登录，此时不开放首次初始化。
如需改用页面设置，删除运行时和构建环境中的旧 `ADMIN_PASSWORD`，部署后立即在页面
创建密码，已有应用和历史记录不会删除。无效的旧 Secret 需先删除或修正。
D1 密码一旦创建，优先级高于旧 Secret，遗留 Secret 不会覆盖它。
部署脚本仍兼容显式提供的构建 `ADMIN_PASSWORD`，使用页面设置时请留空。

`GET /api/v1/auth/session` 返回 `setupRequired: true` 表示可以首次初始化，
不会返回密码凭据。设置页面会在切回标签页时和可见状态下每 15 秒重新检测。

### 忘记密码

没有匿名重置接口。Cloudflare 账号所有者可先临时限制站点访问，
在绑定的 D1 控制台执行：

```sql
DELETE FROM admin_credentials;
DELETE FROM auth_sessions;
DELETE FROM api_tokens;
```

移除遗留的运行时和构建 `ADMIN_PASSWORD`，立即在页面创建新密码，再恢复访问。
此操作保留所有应用及生命周期记录；重置窗口中任何访问者都可能抢先设置密码。

### 数据库初始化错误

若页面提示未绑定数据库，检查生产 Worker 是否有名称精确为 `DB` 的 D1 绑定。
若提示缺表或字段，需在同一数据库执行迁移，不能操作另一份同名数据库。
在 Workers Builds 中将**部署命令**设为 `pnpm run deploy`，
构建命令仍为 `pnpm build`，然后从最新提交重新构建。
仅运行 `wrangler deploy` 不会应用本项目迁移。不要删除数据库或手工重建凭据表。
其他异常会提供可在 Worker 日志中查找的错误编号；排查时不要分享密码或 Cookie。

## API 与语言

已提供 `POST /api/v1/applications` 添加应用接口，使用同源会话和
管理员会话 Cookie 验证。`/api/v1/auth/session`、`/api/v1/auth/login`、
`/api/v1/auth/logout` 分别用于检查状态、登录和退出。
`POST /api/v1/auth/setup` 接收 `password` 与 `confirmPassword`，仅首次初始化可用，
保存后需正常登录，不会自动创建会话。

### 使用 API Token 添加应用

登录后点击顶部 **API Token**，填写名称，选择 7、30（默认）、90 或 365 天有效期。
Token 明文仅在创建时显示一次，不写入浏览器存储，之后无法再次读取。
D1 只保存 SHA-256 哈希、展示前缀、元数据和绑定当前管理员凭据的校验值。
请存入密码管理器或脚本 / CI 的机密存储，不要放入源码、网址、截图或聊天消息。

将 Token 设置为环境变量 `APP_GALLERY_TOKEN`，将示例域名替换为自己的站点：

```sh
curl --fail-with-body 'https://your-worker.workers.dev/api/v1/applications' \
  -H "Authorization: Bearer $APP_GALLERY_TOKEN" \
  -H 'Content-Type: application/json' \
  --data '{"name":"My App","url":"https://example.com","type":"website","launchedOn":"2026-01-01"}'
```

成功返回 HTTP 201 和 `{ "id": "..." }`。必填字段为 `name`、`url` 和 `type`
（`website` / `service` / `app`）；`url` 必须为不含账号密码的 HTTP 或 HTTPS 地址。
可选字段有 `description`、`category`、`tags`、`icon`、`color`、`size`、`favorite`
和 `launchedOn`（UTC `YYYY-MM-DD`，不能在未来；省略或 null 表示未上线）。
每次请求都会新增应用，不自动去重。

Token 只能调用 `POST /api/v1/applications`，不能读取目录、编辑、归档、
修改生命周期或管理 Token。生产必须使用 HTTPS，本地回环地址除外。
脚本无需 Cookie 或 Origin；跨域浏览器请求仍被阻止，不开放宽泛 CORS。
携带无效 Authorization 时不会回退到浏览器登录身份。

管理页最多展示 100 个 Token，未过期且未撤销的 Token 优先，其余按创建时间倒序，
包含状态、到期和最近认证调用时间
（也可能包含认证通过但输入校验失败的请求）。撤销后后续调用失效，
退出浏览器登录不会撤销 Token；管理员密码凭据变更会使旧 Token 失效。
最多保留 20 个未过期且未撤销的 Token，旧凭据失效的 Token 也应及时撤销。
仅启用本地开发绕过不能创建 Token，需要先设置真实管理员密码。

管理接口仅接受同源管理员会话：
`GET /api/v1/auth/tokens`、
`POST /api/v1/auth/tokens`（`name` 与 `expiresInDays`），
以及 `POST /api/v1/auth/tokens/:id/revoke`（空 JSON 对象）。
Bearer Token 不能调用这些管理接口。升级时使用 `pnpm run deploy` 自动迁移 Token 表。

应用界面目前为简体中文；双语支持仅限 README，并非完整的界面国际化。
详细架构见 [技术方案](docs/technical-design.md)，其中包含尚未实现的后续规划。
