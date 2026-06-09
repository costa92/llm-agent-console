---
quick_id: 260609-pq6
slug: memory-base-prefix
date: 2026-06-09
type: quick
---

# Quick Task: fix memory_base missing /memory prefix

## Problem
The committed `config/config.dev.yaml` set `memory_base: "http://localhost:8080"`, but the
memory-gateway mounts its entire API under `/memory/*` (`/memory/write`,
`/memory/recall/unified`, `/memory/items/{id}`, …) — this is the verified route inventory in
PROJECT.md and Phase-2 RESEARCH/CONTEXT. The BFF `http.StripPrefix("/api/memory", …)` turns a
frontend call like `/api/memory/write` into `/write`, then the director re-prefixes from
`memory_base`. With the bare base, the gateway receives `/write` → **404**; the entire Memory
Console is unreachable against a real gateway.

Found during live end-to-end verification (2026-06-09): with the bare base every memory call
404'd; with `http://localhost:8080/memory` the full lifecycle (write / recall / pin with OCC)
returned 200 end-to-end through the deployed BFF.

## Change
1. `config/config.dev.yaml` — `memory_base` → `"http://localhost:8080/memory"` (+ clarifying comment).
2. `internal/router/router.go` — correct the misleading StripPrefix comment (it claimed the
   gateway is reached at `/items/1`; the gateway serves `/memory/items/1`, and the base supplies
   the `/memory` segment — contrast with flow_base which has no path so flowd is reached at root).

## Verify
- `GOWORK=off go build ./... && GOWORK=off go test ./...` pass (config test uses its own inline
  fixture, unaffected).
- e2e (manual, backends up): `POST /api/memory/write` → 200; `GET /api/memory/items/{id}` → 200;
  `POST /api/memory/recall/unified` → scored hit; `POST .../pin` → version bump.
