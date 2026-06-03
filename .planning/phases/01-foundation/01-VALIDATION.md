---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

Two test surfaces (proxy-only BFF + SPA):

| Property | Value |
|----------|-------|
| **Framework (BFF)** | `go test` (+ `net/http/httptest` for SSE pass-through / header-strip assertions) |
| **Framework (SPA)** | Vitest 4.x + @testing-library/react |
| **Config file** | none — Wave 0 scaffolds (`go.mod`, `web/vitest.config.ts`) |
| **Quick run command** | `go test ./... && (cd web && pnpm vitest run)` |
| **Full suite command** | `go test ./... -count=1 && (cd web && pnpm vitest run) && bash scripts/sse-proof.sh` |
| **Estimated runtime** | ~30–60 seconds |

The **BFF-03 keystone** (unbuffered SSE through the real fronting nginx) is validated by an
out-of-process script (`curl -N` against the synthetic `GET /api/stream/test` through nginx
with gzip on — assert events arrive incrementally, not batched), not by a unit test alone.
`scripts/sse-proof.sh` runs BOTH a direct-BFF leg (port 8090) AND a through-nginx leg (port 80
via `docker compose`) — the through-nginx leg is the actual BFF-03 gate per D-06 and ROADMAP SC4.

---

## Sampling Rate

- **After every task commit:** Run the quick run command for the touched surface.
- **After every plan wave:** Run the full suite command.
- **Before `/gsd:verify-work`:** Full suite green, including the SSE-proof script.
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-01 T1 | 01 | 1 | BFF-03 | T-01-01 | No flowd token hardcoded | go test | `go test ./internal/router/... -run TestSyntheticSSE -v && go test ./internal/config/... -v` | internal/router/sse_test.go | ⬜ pending |
| 01-01 T2 | 01 | 1 | BFF-03 | T-01-02 | SSE location before /api/ location; gzip off on SSE route | grep + script | `grep -c 'proxy_buffering off' deploy/nginx.conf && go build -o /tmp/console ./cmd/console && ./scripts/sse-proof.sh` | scripts/sse-proof.sh | ⬜ pending |
| 01-02 T1 | 02 | 2 | — (scaffold) | — | — | build | `cd web && npm install && npx tsc --noEmit` | web/package.json | ⬜ pending |
| 01-02 T2 | 02 | 2 | — (scaffold) | — | — | build | `cd web && npx vite build` | web/vite.config.ts | ⬜ pending |
| 01-03 T1 | 03 | 3 | BFF-02, BFF-04 | T-03-01, T-03-02, T-03-03 | Flowd token not in response; inbound auth stripped; 422/503 passed through verbatim; flowd token absent from forwarded response headers+body | go test | `go test ./internal/proxy/... -run "TestMemoryDirector\|TestFlowDirector\|TestChatDirector\|TestSSEModifyResponse\|TestErrorPassthrough\|TestFlowDirectorResponseNoToken" -v` | internal/proxy/error_test.go | ⬜ pending |
| 01-03 T2 | 03 | 3 | BFF-01, BFF-04 | T-03-04, T-03-05 | Allowlist blocks non-mapped routes; constant-time auth | go test | `go test ./internal/proxy/... -run "TestOperatorAuth\|TestAllowlist\|TestConfigEnv" -v` | internal/proxy/auth_test.go | ⬜ pending |
| 01-04 T1 | 04 | 3 | SHELL-03 | T-04-01 | No operator token in localStorage | vitest | `cd web && npx vitest run src/test/OperatorContext.test.tsx` | web/src/test/OperatorContext.test.tsx | ⬜ pending |
| 01-04 T2 | 04 | 3 | SHELL-01, SHELL-04, SHELL-06 | T-04-01, T-04-04 | No operator token in localStorage; SHELL-06 error toast has Copy error affordance | vitest | `cd web && npx vitest run src/test/NavBar.test.tsx src/test/Toast.test.tsx` | web/src/test/NavBar.test.tsx, web/src/test/Toast.test.tsx | ⬜ pending |
| 01-05 T1 | 05 | 4 | SHELL-05, SHELL-06 | T-05-01 | JSON rendered via stringify, not innerHTML; error body visible only after explicit click | vitest | `cd web && npx vitest run src/test/FiveStateWrapper.test.tsx` | web/src/test/FiveStateWrapper.test.tsx | ⬜ pending |
| 01-05 T2 | 05 | 4 | SHELL-07 | T-05-02, T-05-03 | Clipboard write only on explicit user click; no auto-copy | vitest | `cd web && npx vitest run src/test/RawJsonViewer.test.tsx src/test/CopyableId.test.tsx` | web/src/test/RawJsonViewer.test.tsx, web/src/test/CopyableId.test.tsx | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Go module + `httptest`-based test scaffold for the BFF (header-strip + SSE pass-through seams).
- [ ] `web/` Vite + Vitest scaffold.
- [ ] `scripts/sse-proof.sh` — the BFF-03 keystone proof (`curl -N` direct on :8090 AND through nginx on :80 via docker-compose, gzip compression on at the server block level with per-location override).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| In-browser incremental SSE render through the real fronting proxy | BFF-03 | Browser EventSource/fetch-stream behavior + real proxy chain is integration-level | Run nginx + BFF + synthetic stream; open the test page; confirm events tick in live (not all-at-once) with compression on |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
