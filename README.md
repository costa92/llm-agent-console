[English](./README.md) | [简体中文](./README.zh-CN.md)

# llm-agent-console

A unified web admin / ops console for the `llm-agent` ecosystem: one browser UI to observe and operate the memory gateway, the flow engine (flowd), and the customer-support chat.

## What it is

The ecosystem's three HTTP services — the **memory gateway**, the **flow engine (flowd)**, and the **customer-support chat** — are headless APIs with no frontend. `llm-agent-console` gives operators a single browser UI to see and act on what those backends are doing: inspect and manage memory, build/run/replay flows, and drive chat sessions. It is an internal operator tool, not an end-user product.

The architecture is a thin **BFF (backend-for-frontend) / reverse proxy** on a single origin. The Go BFF injects each upstream's auth model server-side, so there is no browser-side CORS or secret handling. It is a sibling repo nested under the `llm-agent-ecosystem` umbrella, with its own git history.

## Project layout

```
.
├── cmd/console/        # Go BFF entry point (main package)
├── internal/
│   ├── config/         # YAML config loader (upstream base URLs + secrets)
│   ├── router/         # HTTP handler: proxy directors, SSE proof, /healthz, /api/config/env
│   └── proxy/          # Per-upstream proxy directors (memory / flow / chat) + operator-auth middleware
├── config/             # config.dev.yaml — committed local-dev sample
├── deploy/             # docker-compose.yml + nginx.conf (BFF + fronting nginx)
├── scripts/            # sse-proof.sh — SSE pass-through proof
├── Dockerfile          # multi-stage build for the BFF
└── web/                # React + TypeScript + Vite SPA frontend
```

The backend is a small Go BFF (`module github.com/costa92/llm-agent-console`). The `web/` directory is the SPA frontend — React 19 + TypeScript + Vite, with TanStack Query/Router, Tailwind CSS v4, and shadcn/ui. See [web/README.md](./web/README.md) for frontend details.

## Prerequisites

- Go (per `go.mod`, `go 1.25.0`)
- Node.js + npm (for the `web/` SPA)
- The three ecosystem upstreams reachable at the base URLs in `config/config.dev.yaml` (memory gateway, flowd, chat) for full functionality; the synthetic SSE proof and `/healthz` work without them.

## Run locally

### Backend (BFF)

This repo is a standalone sibling that the umbrella `go.work` excludes, so its Go commands require `GOWORK=off`. Run them from the repo root:

```sh
# Run the BFF (defaults to --config config/config.dev.yaml, listens on :8090)
GOWORK=off go run ./cmd/console

# Or build a binary
GOWORK=off go build -o console ./cmd/console
./console --config config/config.dev.yaml

# Tests
GOWORK=off go test ./...
```

The BFF loads its config from a YAML file (fail-fast if missing) and listens on the configured port (default `8090`). `config/config.dev.yaml` is the committed local-dev sample; it points `memory_base`, `flow_base`, and `chat_base` at the local stack and leaves `flowd_token` / `operator_token` empty (empty operator token = auth disabled in dev). Local secret overrides go in `config/config.local.yaml` (gitignored).

The BFF exposes the upstream proxies under `/api/memory/`, `/api/flow/`, and `/api/chat/`, plus `GET /api/stream/test` (synthetic SSE proof), `GET /healthz`, and `GET /api/config/env` (non-secret targeting info).

### Frontend (SPA)

From the `web/` directory:

```sh
npm install
npm run dev        # Vite dev server
npm run build      # tsc -b && vite build → web/dist
npm run lint
npm test           # vitest run
```

### Full stack proof / deploy

`scripts/sse-proof.sh` (run from the repo root) builds and runs the BFF and asserts SSE events stream incrementally — directly against `:8090` and, when Docker is available, through the fronting nginx via `deploy/docker-compose.yml`. The Docker build uses `GOWORK=off` (see `Dockerfile`).

## Relationship to the ecosystem

`llm-agent-console` is a sibling repo under [`llm-agent-ecosystem`](https://github.com/costa92/llm-agent-ecosystem), gitignored from the umbrella and excluded from its `go.work` (hence `GOWORK=off`). It does not modify the backend services — it consumes their existing HTTP APIs unchanged through the BFF:

- **memory gateway** — `memory_base` (dev default `http://localhost:8080`)
- **flow engine (flowd)** — `flow_base` (dev default `http://localhost:7861`)
- **customer-support chat** — `chat_base` (dev default `http://localhost:8081`)
