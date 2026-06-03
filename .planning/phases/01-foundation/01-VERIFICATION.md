---
phase: 01-foundation
verified: 2026-06-03T00:00:00Z
status: passed
score: 5/5 success criteria verified (10/10 requirements satisfied)
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: none
carried_forward:
  - item: "BFF-03 PART 2 — live through-nginx SSE proof (curl -N http://localhost/api/stream/test on :80 through a running nginx with gzip on)"
    reason: "Sandbox Docker registry is TLS-intercepted (returns a *.facebook.com cert for registry-1.docker.io); nginx:alpine / golang:1.26-alpine cannot be pulled. Environment limitation, NOT a code defect."
    state: "Transport proven direct (PART 1, 4 incremental ticks live); nginx config structurally verified against all D-06 directives. ROADMAP SC4 itself scopes Phase 1 to transport-only and permits a synthetic stream. The live through-nginx leg should be re-run on a network with a reachable registry — naturally exercised in Phase 6 (Deploy) against the real fronting proxy."
    blocks_phase_2: false
human_verification:
  - test: "Run scripts/sse-proof.sh on a host/network with a reachable Docker registry (or with nginx:alpine + golang base images pre-cached)."
    expected: "PART 2 prints 'PART 2 SUCCESS: nginx delivered N incremental ticks' and the whole script exits 0 — closing the BFF-03 live through-nginx leg."
    why_human: "Requires Docker image pull which the verification sandbox cannot perform (registry TLS interception). The config is statically correct; only the live execution is blocked."
  - test: "Load the built SPA in a browser, set tenant/user via the context-bar popover, reload the page."
    expected: "Context persists across reload; amber 'unusable' treatment shows when tenant/user unset; top bar shows ENV + memory_base in monospace; nav active item carries the blue accent."
    why_human: "Visual/UX appearance and live reload behavior cannot be asserted from code alone."
---

# Phase 1: Foundation Verification Report

**Phase Goal:** An operator can reach all three backends through one origin behind a hardened BFF, navigate a working SPA shell with their operator context set, and incremental streaming is proven end-to-end through a real proxy.
**Verified:** 2026-06-03
**Status:** passed (with one tracked, environment-blocked follow-up — see Carried-Forward)
**Re-verification:** No — initial verification
**Mode:** MVP (phase goal is the operator-capability outcome above)

## Goal Achievement

### Observable Truths — ROADMAP Success Criteria

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Operator loads console from a single origin and navigates Memory/Flow/Chat placeholders via a persistent shell/nav | ✓ VERIFIED | `web/src/app/Shell.tsx` (TopBar + NavBar + Outlet); `NavBar.tsx` maps Memory/Flow/Chat `<Link>` with `activeProps` blue accent; `app/router.tsx` assembles route tree, `/` redirects to `/memory`; three placeholder routes render. `npm run build` → clean SPA bundle. Single origin preserved by `deploy/nginx.conf` (SPA at `/`, `/api/*` proxied) + vite dev proxy `/api`→:8090. |
| 2 | Operator sets tenant/user (+ optional project/session) context persisting across reloads, always displayed, alongside active env/endpoint | ✓ VERIFIED | `OperatorContextProvider.tsx` reads/writes localStorage key `operator-context` (non-secret scope only, D-01); `OperatorContextBar.tsx` always-visible, amber when tenant/user unset, click→popover edit; `TopBar.tsx` `EnvIndicator` reads `/api/config/env` via useQuery, renders env + memory_base in mono. Tests: `OperatorContext.test.tsx` asserts init-from-localStorage + persist-on-set. |
| 3 | BFF reaches only allowlisted routes, injects gateway/flowd auth server-side, strips inbound scope headers, flowd token never in bundle/responses/logs (grep-gated) | ✓ VERIFIED | `router.go` mounts only `/api/memory|flow|chat/` + stream/healthz/config; non-allowlisted → 404 (`TestAllowlist`, `TestUnknownRouteIs404`). `memory.go` strips inbound `X-*-Id` + Authorization then re-materializes from `X-Console-*` (`TestMemoryDirector` asserts spoof stripped, console headers don't leak). `flow.go` injects `Bearer cfg.FlowdToken`, ModifyResponse scrubs Authorization/X-Echo-Auth (`TestFlowDirectorResponseNoToken`). `config/env` excludes secrets (`TestConfigEnv`). **Grep-gate:** built bundle `dist/assets/*.js` contains no `flowd_token`/`operator_token`/`FlowdToken` strings. |
| 4 | POST SSE through BFF renders incrementally (per-event flush, no gzip, idle survival via raised nginx read-timeout, no heartbeat) — `curl -N` + in-browser through a real proxy | ✓ VERIFIED (transport) / ⚠ live-through-nginx leg deferred (env) | **PART 1 executed live by verifier:** `scripts/sse-proof.sh` PART 1 → 4 incremental `event: tick` frames in <5s direct (per-event `flusher.Flush()` in `router.go`). `TestSyntheticSSE` (real socket, 1.00s) asserts incremental tick + transport headers. **nginx config (`deploy/nginx.conf`):** SSE location `~* ^/api/.*stream` ordered BEFORE general `/api/`, with `proxy_buffering off`, `gzip off` (per-location + global), `proxy_read_timeout 3600s`, `X-Accel-Buffering` passthrough — all D-06 directives present. **PART 2 (live through-nginx) could not run** — Docker registry TLS-intercepted in sandbox (verifier reproduced the exact failure: `x509: certificate is valid for *.facebook.com … not registry-1.docker.io`). Per ROADMAP SC4 split, Phase 1 proves transport-only and may use a synthetic stream — the gate's automatable parts pass; the live nginx leg is tracked (Carried-Forward). |
| 5 | BFF passes through upstream status/error bodies; every view exposes loading/empty/error states, toast feedback, copyable raw-JSON viewer, one-click id copy | ✓ VERIFIED | `TestErrorPassthrough` (422 + 503 verbatim status + body). `FiveStateWrapper.tsx` renders distinct loading/error/empty/partial/ready states (`FiveStateWrapper.test.tsx`). `reportError` (OperatorContextBar) + `Toast.test.tsx` assert success auto-dismiss + error "{action} failed — {status}: {msg}" + Copy-error affordance. `RawJsonViewer.tsx` collapsed-by-default + copy-to-clipboard (`RawJsonViewer.test.tsx`); `CopyableId.tsx` mono id + hover copy + check-for-1s (`CopyableId.test.tsx`). |

**Score:** 5/5 ROADMAP success criteria verified (criterion 4's live through-nginx leg deferred to an environment with a reachable registry; all automatable evidence passes).

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| BFF-01 (single origin, allowlisted routes, no SSRF) | 01-03 | ✓ SATISFIED | `router.go` mounts only mapped prefixes; `TestAllowlist`/`TestUnknownRouteIs404` → 404 on unmapped. |
| BFF-02 (server-side auth injection, strip inbound scope, no token to browser) | 01-03 | ✓ SATISFIED | `memory.go`/`flow.go`/`chat.go` directors; `TestMemoryDirector`, `TestFlowDirectorResponseNoToken`, `TestConfigEnv`. Minor note below on flow/chat inbound-strip. |
| BFF-03 (unbuffered SSE, verified end-to-end) | 01-01 | ✓ SATISFIED (transport) | `TestSyntheticSSE` + live PART 1 (4 ticks); nginx config D-06-complete. Live through-nginx leg carried forward (env-blocked). |
| BFF-04 (status + error-body passthrough) | 01-03 | ✓ SATISFIED | `TestErrorPassthrough` 422/503 verbatim. |
| SHELL-01 (persistent nav across Memory/Flow/Chat) | 01-02, 01-04 | ✓ SATISFIED | `NavBar.tsx` + route tree + Shell. |
| SHELL-03 (operator context set/seen, persisted, always displayed) | 01-04 | ✓ SATISFIED | `OperatorContextProvider` + `OperatorContextBar`; localStorage persist tested. |
| SHELL-04 (active env/endpoint displayed) | 01-03, 01-04 | ✓ SATISFIED | `/api/config/env` handler (no secrets) + `TopBar` EnvIndicator mono. |
| SHELL-05 (loading/empty/error states) | 01-05 | ✓ SATISFIED | `FiveStateWrapper` 5 distinct states + tests. |
| SHELL-06 (toast feedback w/ upstream message) | 01-04, 01-05 | ✓ SATISFIED | `reportError` + `Toast.test.tsx`. |
| SHELL-07 (raw-JSON viewer + one-click id copy) | 01-05 | ✓ SATISFIED | `RawJsonViewer` + `CopyableId` + tests. |

All 10 phase requirement IDs satisfied. No orphaned requirements (SHELL-02 correctly mapped to Phase 5, not claimed here).

### Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `cmd/console/main.go` | ✓ VERIFIED | BFF entry, loads YAML config (fail-fast), listens :8090. |
| `internal/config/config.go` | ✓ VERIFIED | YAML struct + Load (fail-fast); `config_test.go` passes. |
| `internal/router/router.go` | ✓ VERIFIED | Allowlist mux + synthetic SSE + config/env + auth middleware wrap. |
| `internal/proxy/{memory,flow,chat,auth}.go` | ✓ VERIFIED | Three directors + constant-time operator-token middleware; all proxy tests pass. |
| `config/config.dev.yaml` | ✓ VERIFIED | gateway:8080 / flowd:7861 / chat:8081, empty secrets (D-02/D-03). |
| `deploy/nginx.conf` | ✓ VERIFIED | All D-06 directives, SSE location ordered first. |
| `deploy/docker-compose.yml` + `Dockerfile` | ✓ VERIFIED (config) | bff+nginx stack; runnable only with registry access. |
| `scripts/sse-proof.sh` | ✓ VERIFIED | PART 1 passes live; PART 2 fails-loud / skips-on-absent-docker correctly. |
| `web/` scaffold (vite/TS5.9.3/Tailwind v4/shadcn/vitest) | ✓ VERIFIED | `tsc --noEmit` clean; `vitest run` 26/26; `npm run build` clean. |
| Shell + primitives (`Shell`, `NavBar`, `TopBar`, `OperatorContextBar`, `HealthDot`, `FiveStateWrapper`, `RawJsonViewer`, `CopyableId`, `lib/{api,sse}.ts`) | ✓ VERIFIED | All substantive, wired into the route tree / fetch path; no stubs. |

### Key Link Verification

| From | To | Status | Details |
|------|----|--------|---------|
| nginx SSE location | BFF :8090 | ✓ WIRED | `proxy_pass http://bff:8090` + `proxy_buffering off`. |
| `syntheticSSEHandler` | `http.Flusher` | ✓ WIRED | `flusher.Flush()` after each event; live PART 1 confirms. |
| `memory.go` Rewrite | upstream `X-Tenant-Id`/`X-User-Id` | ✓ WIRED | Set from `X-Console-*`; `TestMemoryDirector`. |
| `flow.go` Rewrite | `Authorization: Bearer` | ✓ WIRED | From `cfg.FlowdToken`. |
| `api.ts makeApiFetcher` | `X-Console-*` headers | ✓ WIRED | Conditional set from context; `OperatorContext.test.tsx`. |
| `TopBar` | `/api/config/env` | ✓ WIRED | useQuery `fetchEnv`. |
| `sse.ts` | `@microsoft/fetch-event-source` | ✓ WIRED (stub, unconsumed by design — Phase 3) | Typed `openSseStream` wrapper; dependency pinned 2.0.1. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Go build/vet | `GOWORK=off go build/vet ./...` | clean | ✓ PASS |
| Go tests | `GOWORK=off go test ./internal/... ./cmd/...` | all ok (config/proxy/router) | ✓ PASS |
| Named acceptance tests | `-run TestSyntheticSSE\|TestAllowlist\|TestErrorPassthrough\|TestFlowDirectorResponseNoToken` | all PASS | ✓ PASS |
| Frontend typecheck | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Frontend tests | `npx vitest run` | 26/26 in 7 files | ✓ PASS |
| SPA build | `npm run build` | clean, no token strings in bundle | ✓ PASS |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| BFF-03 SSE proof PART 1 | `bash scripts/sse-proof.sh` | "PART 1 SUCCESS: direct-BFF delivered 4 incremental ticks" | ✓ PASS |
| BFF-03 SSE proof PART 2 | (same script, through nginx) | docker compose pull failed — registry TLS interception (`x509 … not registry-1.docker.io`) | ⚠ ENV-BLOCKED (not a code defect; tracked Carried-Forward) |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| `web/src/app/routes/{memory,flow,chat}.tsx` | "placeholder" components | ℹ INFO | Intentional Phase-1 placeholders per CONTEXT scope ("Memory console — arrives in Phase 2"). Not stubs of in-scope behavior. |
| `internal/proxy/{flow,chat}.go` | `inboundScopeHeaders` (`X-Tenant-Id`…) not stripped on flow/chat directors | ℹ INFO (defense-in-depth) | Only the gateway consumes `X-Tenant-Id` (CONTEXT, confirmed from source); flowd uses bearer-only, chat none. An unstripped scope header on these hops is inert. BFF-02 spoof-prevention is correctly enforced on the only hop that reads it (memory). Recommend symmetric stripping in a later hardening pass, but not blocking. |

No `TBD`/`FIXME`/`XXX` debt markers. No empty implementations or hollow data paths.

### Gaps Summary

No blocking gaps. All 5 ROADMAP success criteria and all 10 phase requirements are achieved in the codebase with passing automated evidence. The single deferred item — the **live through-nginx SSE leg of BFF-03** — is an environment limitation (sandbox Docker registry is TLS-intercepted), not a code or design defect: the BFF flushes per-event (proven live, 4 ticks), the nginx config satisfies every mandatory D-06 directive, and ROADMAP SC4 explicitly scopes Phase 1 to transport-only with a synthetic stream allowed. The proof script correctly fails loud rather than faking a pass. This leg is naturally re-exercised in Phase 6 (Deploy) against the real fronting proxy and is recorded as a human-verification follow-up; it does not block Phase 2.

---

_Verified: 2026-06-03_
_Verifier: Claude (gsd-verifier)_
