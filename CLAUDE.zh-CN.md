<!-- GSD:project-start source:PROJECT.md -->
## 项目

**llm-agent-console**

`llm-agent` 生态的统一 Web **管理 / 运维控制台**。生态的三个 HTTP 服务——**memory 网关**、**flow 引擎（flowd）** 与 **客服聊天（customer-support chat）**——目前都是没有前端的无头 API。本项目给运维人员一个统一的浏览器 UI，去观测并操作这三者：检视与管理 memory、构建/运行/回放 flow，以及驱动聊天会话。它是一个面向内部运维的工具，而非面向终端用户的产品。

**核心价值：** 把生态的无头服务 API 变成一个可用、可观测的统一运维界面。如果其他一切都失败了，运维人员也必须能够从单一 Web UI **看到并操作这些后端服务正在做的事**。

### 约束

- **架构**：轻量 BFF/proxy，单一源（single origin）——BFF 在服务端注入全部三种 auth 模型；浏览器侧不处理 CORS 或机密。*（在稳健性/安全性上优于「直连 + CORS」，且因为这 3 个服务有 3 种不同的 auth 模型。）*
- **技术栈**：**由 GSD 研究决定**（2025 管理控制台标准栈）——不预先敲定。BFF 可以是 Go（生态原生）或所选前端框架的服务端层。
- **仓库放置**：单独的兄弟仓（`llm-agent-console`），嵌套在伞形仓库下，被其 gitignore；拥有自己的 git 历史 + `.planning/`。*（多仓约定。）*
- **后端契约是固定的**：原样消费既有 API；不修改后端服务。
<!-- GSD:project-end -->

<!-- GSD:stack-start source:research/STACK.md -->
## 技术栈

## 头号推荐
## 推荐栈
### 核心技术
| 技术 | 版本 | 用途 | 推荐理由 |
|------------|---------|---------|-----------------|
| **React** | 19.2.x | UI 库 | 内部工具的默认选择；React 19 稳定；当前 shadcn/ui 与 TanStack 所必需。 |
| **Vite** | 8.0.x | 构建工具 / 开发服务器 | SPA 优化：亚秒级 HMR、零配置 TS、随处部署的静态产物。在 SSR/SEO 无关紧要的内部仪表盘中是标准。 |
| **TypeScript** | 5.9.x（暂不用 6.x） | 语言 | 对 BFF↔SPA 契约做端到端类型化。见版本兼容性说明——锚定到 5.9，而非刚发布的 6.0。 |
| **Go（本仓）** | 1.23+ | **BFF / 反向代理** | 生态原生（3 个后端都是 Go）；`httputil.ReverseProxy` 在 `FlushInterval=-1` 下对 `text/event-stream` 自动 flush；按后端逐一做服务端 auth 注入很简单。 |
| **TanStack Query** | 5.101.x | 服务端状态 / 数据获取与缓存 | REST-over-HTTP 管理 UI 的标准：缓存、去重、失效、对 memory CRUD + flow CRUD 的乐观更新（optimistic mutations）。**SSE 流绕过它**（见 SSE 一节）。 |
| **TanStack Router** | 1.170.x | 路由 | 类型安全的路由、一等公民的搜索参数状态（过滤/分页）、与 TanStack Query 原生配合的 loader 预取。对全新的类型化 SPA，优于 React Router。 |
| **Tailwind CSS** | 4.3.x | 样式 | v4 引擎（`@import "tailwindcss"`、`@tailwindcss/vite` 插件）。shadcn/ui 所需的底座。 |
| **shadcn/ui** | CLI 3.x | UI 组件套件 | 拷入式组件（代码归你所有），基于 Radix 原语 + Tailwind 构建。内部控制台中打磨度/可控性最佳；无运行时依赖锁定。支持 React 19 + Tailwind v4。 |
### 配套库
| 库 | 版本 | 用途 | 何时使用 |
|---------|---------|---------|-------------|
| **@microsoft/fetch-event-source** | 2.0.1 | SSE-over-`fetch` 客户端（POST + headers + 重试控制） | **必需**——两个 SSE 端点都是 POST；原生 `EventSource` 无法 POST。见说明：该包于 *2026-04 被重新发布/复活*（npm `modified` 2026-04-23），所以它重新成为现行选择。 |
| **@tailwindcss/vite** | 4.3.x | Tailwind v4 的 Vite 插件 | 始终（Tailwind v4 集成）。 |
| **@tanstack/react-table** | 8.21.x | 无头表格 | memory 项列表、运行列表、flow 列表——通过 URL 搜索参数做服务端排序/过滤/分页。 |
| **lucide-react** | latest（shadcn 默认的图标集） | 图标 | shadcn/ui 默认图标库。 |
| **sonner** | 2.0.x | Toast | 运维反馈（写入/补丁/删除/钉住的成功/失败）。shadcn 推荐的 toast。 |
| **zod** | 4.4.x | 运行时 schema 校验 | 在编辑器中校验 flow JSON；解析/收窄 BFF 响应。 |
| **react-hook-form** | 7.77.x | 表单 | memory 写入/补丁表单、flow 创建/编辑。与 zod resolver 配合。 |
| **@tanstack/react-query-devtools** | （匹配 Query 5.x） | 调试缓存 | 仅开发用。 |
### 开发工具
| 工具 | 用途 | 备注 |
|------|---------|-------|
| **Vitest** 4.1.x | 单元/组件测试 | Vite 原生测试运行器；复用 Vite 的配置/转换。 |
| **@testing-library/react** | 组件测试 | 与 Vitest 配套的标准。 |
| **ESLint + typescript-eslint** | Lint | Flat config。 |
| **Go `net/http` + `httptest`** | BFF 测试 | 用发出 `text/event-stream` 的 `httptest.NewServer` 测试 SSE 透传。 |
## 安装
# 脚手架 SPA
# 核心数据/路由
# SSE-over-POST 客户端（必需——EventSource 不能 POST）
# 样式 + UI（Tailwind v4）
# 表单 / 校验 / toast / 图标
# 开发
## BFF 还是框架服务端层——权衡已解决
| 维度 | Go BFF + Vite SPA（推荐） | Next.js App Router 服务端 | TanStack Start | SvelteKit |
|-----------|--------------------------------|---------------------------|----------------|-----------|
| SSE 代理正确性 | **对 `text/event-stream` 自动 flush**（Go 标准库） | 有记录在案的缓冲陷阱；handler 可能缓冲到返回为止；需要 `X-Accel-Buffering: no`、不压缩、手写 `ReadableStream` | 基于 Vite，可行，但仍有 JS 运行时流式注意点 | 可行，但有 JS 运行时注意点 |
| 生态契合度 | **原生**——3 个后端已是 Go；共享惯用法，运维层一种语言 | 在 Go 服务旁新增一个 JS 服务运行时 | 新增 JS 服务 | 新增 JS 服务 |
| auth 注入 | 简单的 `Rewrite`/`Director`；机密在 Go env | 路由 handler / 中间件 | 服务端函数 | hooks |
| 运维面 | 一个静态 bundle + 一个微型 Go 二进制 | 需要运行/扩容/打补丁的 Node 服务 | Node 服务 | Node 服务 |
| 「免费 BFF」价值 | 不适用——代理约 ~100 行 Go | 真实存在，但在这里会带来问题 | 真实，但用不上 | 真实，但用不上 |
| SSR/SEO 收益 | 不需要（内部工具） | 浪费 | 浪费 | 浪费 |
## SSE 经过 BFF——影响
- 原生 **`EventSource` 只能 GET，无法发送自定义 headers 或请求体** → 不可用，因为 flowd run-stream 和 chat-stream 都是 **POST**。改用 **`@microsoft/fetch-event-source`**（`fetchEventSource`），它通过 `fetch` 流式传输，支持 POST + headers、手动重试/中止，以及 `onmessage`/`onerror` 钩子。
- SSE 流 **不**由 TanStack Query 的缓存管理。在 effect/hook 里命令式地驱动它们（触发运行时打开、把事件追加到本地组件状态、在 `done`/卸载时关闭）。仅用 TanStack Query 处理外围的 REST CRUD（启动一次运行，然后在流结束后获取 `/runs/{id}` / `/runs/{id}/events`，并使运行列表失效）。
- `httputil.ReverseProxy` 对 `Content-Type: text/event-stream`（含 `;charset=utf-8`）自动 flush——事件立即到达浏览器，不批处理。
- **不要**在 SSE 路由上包任何缓冲/压缩中间件（不 gzip、不做响应缓冲日志）。缓冲中间件会把流变成批处理。
- 如果前置代理（nginx/Traefik/ALB）曾置于 BFF 之前，确保上游 SSE 响应带上 `X-Accel-Buffering: no` 与 `Cache-Control: no-cache, no-transform`；原样透传它们。
- 若有中间件会杀掉空闲连接（~30–60s），在长时间空闲的流上加周期性 **心跳/keep-alive** 注释（`: ping\n\n`）。确认 flowd/chat 是否已经发送它们；若没有，BFF 可注入——但更倾向于不重写流体，只透传。
- 传播客户端断连：当浏览器中止时取消上游请求，以免 flowd/chat 在脱离后仍继续运行。
## 已考虑的替代方案
| 推荐 | 替代 | 何时使用替代 |
|-------------|-------------|-------------------------|
| Vite SPA + Go BFF | **Next.js App Router**（内置 BFF） | 如果你需要 SSR/SEO（你不需要），或必须交付单一 JS 产物并愿意付出 SSE 加固成本。 |
| Vite SPA + Go BFF | **TanStack Start** | 如果你想要一套 TS 代码库带同构 loader/server-fn，并接受在 Go 服务旁有个 Node 运行时。SSE 故事比 Next 更干净，但这里仍用不上。 |
| React | **SvelteKit** | 如果团队是 Svelte 原生；更小的 bundle、内置 BFF 端点。会失去适合管理工具的 React/shadcn/TanStack 生态深度。 |
| shadcn/ui（基于 Radix） | **Mantine** | 如果你想要开箱即用的表格/表单/通知，而不必接 5–8 个包——更快引导仪表盘，设计可控性更低。运维控制台的有力第二选择。 |
| shadcn/ui | **原生 Radix UI** | 如果你只想要原语并打造完全定制的设计系统（前期工作更多）。 |
| TanStack Router | **React Router 7**（7.16.x） | 如果团队已熟悉 React Router；成熟，但对全新项目而言类型安全/搜索参数人体工学不如 TanStack Router。 |
| @microsoft/fetch-event-source | **@fortaine/fetch-event-source**（3.0.6） | MS 包停更时它是被维护的 fork——但 MS 包已于 **2026-04-23 重新发布**（该 fork 最后改动于 2023）。除非需要某个特定 fork 修复，否则优先用上游。 |
| @microsoft/fetch-event-source | **`fetch()` + 手写 `ReadableStream` SSE parser** | 如果你想要零依赖并完全可控；你需要自己重新实现事件分帧/重试。鉴于只有 2 个流端点尚算合理，但该库小巧且久经考验。 |
## 不要使用什么
| 避免 | 原因 | 改用 |
|-------|-----|-------------|
| 原生 **`EventSource`** | 只能 GET；无法发送 POST 体或 auth/`X-Tenant-Id` headers——两个流端点都是 POST | `@microsoft/fetch-event-source`（基于 fetch） |
| **把 Next.js App Router 当 BFF** | SSE 缓冲陷阱（handler 缓冲到返回为止；需要手写 `ReadableStream`、禁用压缩、`X-Accel-Buffering: no`）；在 Go 服务旁增加 Node 运行时；SSR 在内部工具上是浪费 | 轻量的 Go `httputil.ReverseProxy` |
| **浏览器 → 后端直连 + CORS** | 3 种不同 auth 模型、浏览器内处理机密、在你无法修改的固定后端上做 CORS | 单一源 Go BFF（已是项目约束） |
| **SSE 路由上的 gzip/响应缓冲中间件** | 批处理掉流，破坏实时 UX | 让 SSE 路由不经缓冲地透传 |
| **TypeScript 6.0**（刚发布） | 与当前 shadcn/Vite/TanStack 的工具对齐尚太新；生态类型落后一个大版本 | TypeScript 5.9.x |
| **Redux / 为服务端数据用重型全局状态** | 对 REST 数据的缓存/去重/失效而言过度设计 | TanStack Query（服务端状态）+ 流用本地状态 |
| **MUI / Ant Design** | 相较自有的 shadcn 组件，运行时更重、主题更固执、bundle 更大 | shadcn/ui（或想要开箱即用则用 Mantine） |
| **WebSockets** | 后端讲 SSE；不需要双向（仅服务端→客户端） | SSE over fetch |
## 按变体的栈模式
- Vite + React 19 + TanStack Router/Query + shadcn/ui + Go BFF。
- 因为它契合内部工具标准，并把运维/auth 平面保持在 Go。
- 把 shadcn/ui 换成 **Mantine**（内置表格/表单/通知/暗色模式）。
- 因为每个仪表盘都需要这些，而 Mantine 不必逐功能接包就能提供。
- 在 Next.js 之前重新考虑 **TanStack Start**（基于 Vite，SSE 比 Next 更干净）。
- 因为它在增加服务端层的同时保留了 Vite/TanStack 的人体工学——但要为 SSE flush 加固预留预算。
## 版本兼容性
| 包 A | 兼容于 | 备注 |
|-----------|-----------------|-------|
| react 19.2.x | react-dom 19.2.x | 锁步；当前 shadcn/ui 与 TanStack 所必需。 |
| tailwindcss 4.3.x | @tailwindcss/vite 4.3.x | v4 使用 `@tailwindcss/vite` 插件 + `@import "tailwindcss"`；**不是**旧的 `@tailwind` 指令 / PostCSS 配置。 |
| shadcn CLI 3.x | React 19 + Tailwind v4 | 当前 shadcn 组件同时面向两者；假设 Tailwind v3 的旧指南已过时。 |
| @tanstack/react-router 1.170.x | @tanstack/react-query 5.101.x | 设计为可组合（router loader 预取进 Query 缓存）。 |
| typescript | **锚定 5.9.x，避免 6.0.x** | 6.0 刚发布；先让 shadcn/Vite/TanStack/eslint 的类型生态跟上再采用。 |
| @microsoft/fetch-event-source 2.0.1 | 支持 fetch 的浏览器 | 2026-04-23 重新发布；版本号仍是 2.0.1，但重新进入活跃维护。 |
| Go httputil.ReverseProxy | Go 1.12+（用 1.23+） | 对 `text/event-stream` 自动 `FlushInterval=-1` 早已落地；现代 Go 还提供 `Rewrite` 钩子（取代已弃用的 `Director`）。 |
## 来源
- npm registry（`npm view <pkg> version` / `time.modified`），2026-06-03 —— HIGH：vite 8.0.16、react 19.2.7、@tanstack/react-query 5.101.0、@tanstack/react-router 1.170.11、react-router 7.16.0、@tanstack/react-table 8.21.3、tailwindcss 4.3.0、@tailwindcss/vite 4.3.0、typescript 6.0.3（避免；锚定 5.9）、zod 4.4.3、vitest 4.1.8、react-hook-form 7.77.0、sonner 2.0.7、@microsoft/fetch-event-source 2.0.1（modified 2026-04-23）、@fortaine/fetch-event-source 3.0.6（modified 2023-01-19）。
- Context7 库解析 —— HIGH：`/vitejs/vite`、`/tanstack/query`、`/reactjs/react.dev`、`/remix-run/react-router`、`/shadcn-ui/ui`。
- golang/go issues #27816、#41642、#47359 + Go 标准库 reverseproxy 源码 —— HIGH：ReverseProxy 流式/`FlushInterval` 行为，对 `text/event-stream` 自动 `-1`。
- Next.js 流式文档 + vercel/next.js discussion #48427 + 多篇 SSE-in-Next 文章 —— MEDIUM：App Router SSE 缓冲陷阱、`X-Accel-Buffering: no`、禁用压缩。
- MDN「Using server-sent events」+ LogRocket「Fetch Event Source」+ Azure/fetch-event-source 仓库 —— HIGH：`EventSource` 只能 GET 的限制；用基于 fetch 的 SSE 支持 POST/headers。
- React UI 库对比（Makers' Den、SaaSIndie、shadcn/ui 文档的 Tailwind v4 + Vite 安装）2025–2026 —— MEDIUM：shadcn vs Mantine vs Radix 权衡；shadcn 对 React 19 + Tailwind v4 的支持。
- Vite-vs-Next / TanStack Start 对比（LogRocket、TanStack 文档、DEV）2025–2026 —— MEDIUM：内部工具偏好 Vite 的 SPA 共识。
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## 约定

约定尚未确立。将随着开发过程中模式的浮现而填充。
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## 架构

架构尚未梳理。遵循代码库中既有的模式。
<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->
## 项目技能

未找到项目技能。将技能添加到以下任一目录：`.claude/skills/`、`.agents/skills/`、`.cursor/skills/`、`.github/skills/` 或 `.codex/skills/`，并附带一个 `SKILL.md` 索引文件。
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD 工作流强制

在使用 Edit、Write 或其他改文件的工具之前，先通过 GSD 命令开始工作，以保持规划工件与执行上下文同步。

使用这些入口：
- `/gsd-quick` 用于小修复、文档更新和临时任务
- `/gsd-debug` 用于调查与修 bug
- `/gsd-execute-phase` 用于已规划的阶段工作

除非用户明确要求绕过，否则不要在 GSD 工作流之外直接编辑仓库。
<!-- GSD:workflow-end -->



<!-- GSD:profile-start -->
## 开发者画像

> 画像尚未配置。运行 `/gsd-profile-user` 以生成你的开发者画像。
> 本节由 `generate-claude-profile` 管理——请勿手动编辑。
<!-- GSD:profile-end -->
