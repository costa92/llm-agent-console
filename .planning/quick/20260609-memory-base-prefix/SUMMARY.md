---
quick_id: 260609-pq6
slug: memory-base-prefix
date: 2026-06-09
type: quick
status: complete
---

# Summary: fix memory_base missing /memory prefix

**Changed:**
- `config/config.dev.yaml`: `memory_base` `"http://localhost:8080"` → `"http://localhost:8080/memory"` (+ comment explaining the gateway mounts `/memory/*` and the BFF strips `/api/memory`).
- `internal/router/router.go`: corrected the StripPrefix comment to reflect that the director re-prefixes from the base (flowd at root, gateway under `/memory`).

**Why:** The bare base made every Memory Console call 404 at the real gateway (BFF strips `/api/memory`→`/write`, gateway serves `/memory/write`). Confirmed by live e2e: bare base 404s; `/memory` base → write/recall/pin all 200.

**Verification:** `GOWORK=off go build ./...` + `go test ./...` pass (the config unit test uses its own inline YAML fixture, so it is unaffected). Memory Console proven end-to-end against a real memory-gateway + Postgres.

**Note:** This corrects the local-dev sample only. If the production deployment fronts the gateway differently (an ingress that already injects `/memory`), the prod config must be set accordingly — `memory_base` is the single knob.
