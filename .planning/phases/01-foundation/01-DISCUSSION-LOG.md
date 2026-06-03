# Phase 1: Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-03
**Phase:** 01-foundation
**Areas discussed:** BFF operator auth, Upstream config + local dev, Packaging / dev layout, Operator-context entry UX

---

## BFF operator authentication

| Option | Description | Selected |
|--------|-------------|----------|
| Trusted network + optional shared token | Default network/ingress trust; BFF optionally enforces one shared static token via config (off in local dev) | ✓ |
| Same-origin cookie session | Login → httpOnly cookie; SSE carries cookie natively; needs login/session machinery | |
| No auth at all | BFF gates nothing; local/isolated only | |

**User's choice:** Trusted network + optional shared token (recommended).
**Notes:** Consistent with PROJECT.md "Out of Scope: per-end-user login/RBAC". Distinct from upstream auth the BFF injects (flowd bearer, gateway scope headers).

---

## Upstream configuration + local dev

| Option | Description | Selected |
|--------|-------------|----------|
| env vars + localhost defaults | Per-upstream base URL + FLOWD_TOKEN via env; dev defaults to compose ports | |
| Config file (YAML/JSON) | One config file describes the 3 upstreams + secrets | ✓ |

**User's choice:** Config file (YAML/JSON).
**Notes:** File is the source of truth; env may override secrets only. Local-dev sample points at compose ports; chat mapped to :8081 to avoid the gateway/chat :8080 collision (both default 8080).

---

## Packaging / dev layout

| Option | Description | Selected |
|--------|-------------|----------|
| Single binary `go:embed` | Go BFF embeds the built SPA; one artifact serves static + proxies | |
| Proxy-only BFF + separate static hosting | SPA built separately, served by nginx/CDN; BFF only proxies the API | ✓ |

**User's choice:** Proxy-only BFF + separate static hosting.
**Notes:** Single origin is preserved by a fronting static host (nginx serves SPA at `/` + reverse-proxies `/api/*` → BFF). Consequence locked as a hard constraint: the fronting proxy is now a mandatory SSE-buffering surface — BFF-03's proof must run through it (proxy_buffering off, no gzip on streams, X-Accel-Buffering passthrough).

---

## Operator-context entry UX

| Option | Description | Selected |
|--------|-------------|----------|
| Persistent bar inline edit + remember last | Click bar → popover edit; free-form; localStorage last-used; amber "unusable" when unset | ✓ |
| + "recent contexts" quick-select | Above plus a saved-recents dropdown for faster tenant switching | |
| Dedicated settings page | Context on a separate settings page instead of the always-visible bar | |

**User's choice:** Persistent bar inline edit + remember last (recommended).
**Notes:** Matches the approved UI-SPEC. "Recent contexts" quick-select deferred to v1.x.

## Claude's Discretion

- Config file format (YAML vs JSON) — YAML preferred for comments.
- API route prefix / per-service namespacing (`/api/memory/*`, `/api/flow/*`, `/api/chat/*`).
- Exact SSE-proof mechanism for BFF-03 (synthetic test stream vs real flowd run) — must run through the fronting proxy.

## Deferred Ideas

- "Recent contexts" quick-select in the context bar — v1.x.
- Single-binary `go:embed` packaging — not chosen; recorded for possible later revisit.
- Env-var-first configuration — not chosen; env stays a secret-override path only.
