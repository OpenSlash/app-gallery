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
需要测试真实登录时，不设置 `LOCAL_DEV`，改为在 `.dev.vars` 中设置
16 至 256 位的独立 `ADMIN_PASSWORD`。

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
**`pnpm deploy`**，不能只执行 `wrangler deploy`。
发布脚本会先查找配置名称对应的 D1，不存在时创建，再将真实 ID 写入
`wrangler.jsonc`，执行迁移，并重新构建 Vite 产物后发布。
若构建产物的 ID 与实际绑定不一致，会终止发布。
Cloudflare 模板流程也可能提前创建数据库；已有真实 ID 时会保留。

**不再需要开通或配置 Cloudflare Zero Trust / Access。**

1. 在部署页面的 `ADMIN_PASSWORD` 中设置 16 至 256 位的独立长密码，
   建议使用密码管理器生成。该字段由 `.dev.vars.example` 声明，
   Cloudflare 将其作为 Worker Secret，而不是公开配置变量。
   如果 Cloudflare 将其提供为构建 Secret，`pnpm deploy` 会在发布时显式上传为
   运行时 Worker Secret，不写入源码配置或前端产物。
2. 完成部署，打开 Worker 地址，用该密码登录。
3. 确认未登录请求 `/api/v1/applications` 返回 401，再录入真实资料。

未设置密码或密码过短时，页面显示配置指引，数据 API 返回 503。
可在 Worker 的设置 > 变量和机密中，添加类型为 **Secret** 的
`ADMIN_PASSWORD`，保存并部署。不要将真实密码放入 `wrangler.jsonc`、
源代码或 `VITE_*` 变量。
如果直接在 Worker 设置中管理密码，请留空构建环境的 `ADMIN_PASSWORD`。
两处都配置时，每次部署都会上传构建环境中的值，覆盖运行时的旧值。

会话有效期 12 小时，HTTPS 下使用仅限当前主机的 HttpOnly、Secure、
SameSite=Strict Cookie。D1 只存令牌哈希和绑定当前密码的校验值；
退出会撤销服务端会话，修改密码会使旧密码签发的会话失效。
没有公开注册或网页找回密码入口，忘记密码时修改 Worker Secret 即可。
内置登录限流按 IP 和 Cloudflare 节点限制每分钟 5 次，不是全局严格配额。
页面外壳不包含业务数据，动态预览 URL 默认关闭。

### 命令行部署

不使用部署按钮时，先登录，再执行完整部署：

```sh
pnpm exec wrangler login
pnpm deploy
pnpm exec wrangler secret put ADMIN_PASSWORD
```

生产账号资源和真实云端发布尚未在本仓库执行。
如需其他数据库名称，在首次部署前修改 `wrangler.jsonc` 中的 `database_name`；
如需使用指定数据库，直接填入其真实 `database_id`。命令行部署会将解析到的
真实 ID 写入配置，建议在自己的部署仓库中保留该 ID。
最后一条命令会安全提示输入管理员密码；设置完成前数据接口保持锁定。

### D1 错误 10181 恢复

若报错中的数据库 ID 为 `00000000-0000-0000-0000-000000000000`，
说明仍在使用旧模板或旧构建。先更新 Cloudflare 实际关联的仓库；
若一键部署复制了一份仓库到你的账号，需要同步那份副本，不能只更新上游。

在 Workers Builds 设置中确认部署命令为 `pnpm deploy`，然后从最新提交
启动一次全新构建。不要只重试旧产物，也不要仅在后台添加绑定却保留源码的假 ID。
新版脚本会根据配置名称修复旧版全零 ID，不会自动替换非占位 ID，也不会删除数据库。

### 旧版本升级

将更新拉取到你的部署仓库，执行 `pnpm build` 和 `pnpm deploy`，
后者会应用新增的会话表迁移，再设置 `ADMIN_PASSWORD` Secret。
确认密码登录正常后，可移除旧 Access 应用或 Worker 保护，避免额外登录。
`ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 不再使用，已有应用及历史数据保留。

### 已设置密码仍显示设置页面

打开同一生产域名下的 `/api/v1/auth/session`，查看 `configurationIssue`：
`missing` 表示当前运行的 Worker 没有收到变量，`too_short` 表示过短，
`too_long` 表示过长。合法密码（包括恰好 16 位）会返回
`configured: true` 和 `configurationIssue: null`，不会返回密码或具体长度。

若为 `missing`，检查变量是否配置在当前网址对应的 Worker 和生产环境，
而不是只配置在构建设置中；添加运行时 Secret 后需点击部署。
也可以更新部署脚本，设置构建 Secret，然后以 `pnpm deploy` 重新构建部署。
构建变量不会天然成为运行时绑定，新脚本会显式上传。
设置页面会在切回标签页时和可见状态下每 15 秒重新检测，也可手动点击检查。

## API 与语言

已提供 `POST /api/v1/applications` 添加应用接口，使用同源会话和
管理员会话 Cookie 验证。`/api/v1/auth/session`、`/api/v1/auth/login`、
`/api/v1/auth/logout` 分别用于检查状态、登录和退出。
目前没有独立 API Token 或 CI 自动化认证能力。

应用界面目前为简体中文；双语支持仅限 README，并非完整的界面国际化。
详细架构见 [技术方案](docs/technical-design.md)，其中包含尚未实现的后续规划。
