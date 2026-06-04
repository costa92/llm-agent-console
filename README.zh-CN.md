[English](./README.md) | [简体中文](./README.zh-CN.md)

# llm-agent-console

`llm-agent` 生态的统一 Web 管理 / 运维控制台：用一个浏览器 UI 观测并操作 memory 网关、flow 引擎（flowd）以及客服聊天（customer-support chat）。

## 这是什么

生态中的三个 HTTP 服务——**memory 网关**、**flow 引擎（flowd）** 与 **客服聊天（customer-support chat）**——都是没有前端的无头（headless）API。`llm-agent-console` 为运维人员提供一个统一的浏览器 UI，去查看并操作这些后端正在做的事：检视与管理 memory、构建/运行/回放 flow，以及驱动聊天会话。它是一个面向内部运维的工具，而非面向终端用户的产品。

整体架构是单一源（single origin）上的轻量 **BFF（backend-for-frontend）/ 反向代理**。Go BFF 在服务端注入各上游的 auth 模型，因此浏览器侧无需处理 CORS 或机密。它是嵌套在 `llm-agent-ecosystem` 伞形（工作区）下的兄弟仓，拥有自己独立的 git 历史。

## 项目结构

```
.
├── cmd/console/        # Go BFF 入口（main 包）
├── internal/
│   ├── config/         # YAML 配置加载器（上游 base URL + 机密）
│   ├── router/         # HTTP handler：代理 director、SSE proof、/healthz、/api/config/env
│   └── proxy/          # 各上游的代理 director（memory / flow / chat）+ operator-auth 中间件
├── config/             # config.dev.yaml —— 已提交的本地开发样例
├── deploy/             # docker-compose.yml + nginx.conf（BFF + 前置 nginx）
├── scripts/            # sse-proof.sh —— SSE 透传证明
├── Dockerfile          # BFF 的多阶段构建
└── web/                # React + TypeScript + Vite 的 SPA 前端
```

后端是一个小型 Go BFF（`module github.com/costa92/llm-agent-console`）。`web/` 目录是 SPA 前端——React 19 + TypeScript + Vite，搭配 TanStack Query/Router、Tailwind CSS v4 与 shadcn/ui。前端细节见 [web/README.md](./web/README.md)。

## 前置条件

- Go（依 `go.mod`，`go 1.25.0`）
- Node.js + npm（用于 `web/` SPA）
- 完整功能需要三个生态上游可在 `config/config.dev.yaml` 中的 base URL 处访问（memory 网关、flowd、chat）；合成 SSE proof 与 `/healthz` 无需它们即可工作。

## 本地运行

### 后端（BFF）

本仓是一个独立的兄弟仓，被伞形 `go.work` 排除在外，因此它的 Go 命令需要 `GOWORK=off`。从仓库根目录运行：

```sh
# 运行 BFF（默认 --config config/config.dev.yaml，监听 :8090）
GOWORK=off go run ./cmd/console

# 或构建二进制
GOWORK=off go build -o console ./cmd/console
./console --config config/config.dev.yaml

# 测试
GOWORK=off go test ./...
```

BFF 从 YAML 文件加载配置（缺失则快速失败 fail-fast），并监听所配置的端口（默认 `8090`）。`config/config.dev.yaml` 是已提交的本地开发样例；它将 `memory_base`、`flow_base`、`chat_base` 指向本地栈，并将 `flowd_token` / `operator_token` 留空（空 operator token = 开发环境下禁用 auth）。本地机密覆盖放在 `config/config.local.yaml`（已 gitignore）。

BFF 在 `/api/memory/`、`/api/flow/`、`/api/chat/` 下暴露上游代理，另外还有 `GET /api/stream/test`（合成 SSE proof）、`GET /healthz` 以及 `GET /api/config/env`（非机密的目标信息）。

### 前端（SPA）

在 `web/` 目录下：

```sh
npm install
npm run dev        # Vite 开发服务器
npm run build      # tsc -b && vite build → web/dist
npm run lint
npm test           # vitest run
```

### 全栈证明 / 部署

`scripts/sse-proof.sh`（从仓库根目录运行）会构建并运行 BFF，断言 SSE 事件是增量流式到达的——既直接对 `:8090` 验证，也在 Docker 可用时通过 `deploy/docker-compose.yml` 经由前置 nginx 验证。该 Docker 构建使用 `GOWORK=off`（见 `Dockerfile`）。

## 与生态的关系

`llm-agent-console` 是 [`llm-agent-ecosystem`](https://github.com/costa92/llm-agent-ecosystem) 下的一个兄弟仓，被伞形仓库 gitignore 并排除出其 `go.work`（因此需要 `GOWORK=off`）。它不修改后端服务——它通过 BFF 原样消费这些服务既有的 HTTP API：

- **memory 网关** —— `memory_base`（开发默认 `http://localhost:8080`）
- **flow 引擎（flowd）** —— `flow_base`（开发默认 `http://localhost:7861`）
- **客服聊天（customer-support chat）** —— `chat_base`（开发默认 `http://localhost:8081`）
