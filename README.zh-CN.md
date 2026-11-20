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
- D1 数据持久化、API 校验、Access JWT 验证与未配置时安全锁定。

当前每个应用只管理一个生产部署、一个访问地址。多环境、多入口、
迁移、导入导出、在线监测及文件上传不在这一轮实现。
上线日期使用 UTC，所有“天数”均为台账时长，不是实际在线率。

## 本地开发

建议使用 Node.js 24 LTS 和 pnpm 10。不需要 Cloudflare 登录。

```sh
pnpm install --frozen-lockfile
cp .dev.vars.example .dev.vars
```

将本地 `.dev.vars` 中的 `LOCAL_DEV` 改为 `true`，再执行：

```sh
pnpm db:local
pnpm dev
```

打开终端输出的本地地址。开发身份仅在 localhost / 127.0.0.1 生效。
不要将 `LOCAL_DEV=true` 添加到生产配置。
示例预览不写入数据库，新安装实例不会预置示例应用。

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
在 Cloudflare 部署页面接受 `pnpm build` 和 `pnpm deploy` 命令；
Cloudflare 自动创建 D1 并替换模板数据库 ID，发布脚本通过 `DB` binding 建表。

这是一键部署应用，不是一键配置身份提供方。上线前仍需：

1. 创建 Cloudflare Access 应用，设置最小邮箱白名单。
2. 将 `ACCESS_TEAM_DOMAIN` 和 `ACCESS_AUD` 填入 `wrangler.jsonc` 的
   `vars`（或部署页面同步到仓库的配置），重新构建并发布。
   不要只改后台变量却在仓库保留空值，否则下次部署可能覆盖配置。
3. 使用自定义域名保护整个站点，或在 workers.dev 上启用相应 Access 保护。
4. 验证匿名请求被拒绝，授权用户可读写，再录入真实资料。

未配置 Access 时 API 返回 503；缺少合法 JWT 时返回 401。
`workers.dev` 默认保留以便部署后访问，API 也会独立验证 JWT，
不会因为某个域名未受 Access 保护而泄露数据。页面外壳不包含业务数据。
动态预览 URL 默认关闭。

### 命令行部署

不使用部署按钮时，先登录、创建 D1，并将实际 ID 写入 `wrangler.jsonc`：

```sh
pnpm exec wrangler login
pnpm exec wrangler d1 create app-gallery
pnpm build
pnpm deploy
```

生产账号资源和真实云端发布尚未在本仓库执行。

## API 与语言

已提供 `POST /api/v1/applications` 添加应用接口，使用同源会话和
Cloudflare Access 身份验证。目前没有独立 API Token 或 CI 自动化认证能力。

应用界面目前为简体中文；双语支持仅限 README，并非完整的界面国际化。
详细架构见 [技术方案](docs/technical-design.md)，其中包含尚未实现的后续规划。
