# Phase 5: Health & Hardening - Discussion Log

> **Audit trail only.** Not consumed by downstream agents — decisions live in CONTEXT.md.

**Date:** 2026-06-04
**Phase:** 5-health-hardening
**Areas discussed:** Health probe architecture, Reconnect/backoff, Five-state hardening scope

---

## Health probe architecture

| Option | Selected |
|--------|----------|
| BFF aggregate /api/health (one poll, server-side probes all three) | ✓ |
| SPA polls each service through the BFF (3-way fan-out) | |
| BFF aggregate + degraded from /readyz | |

**Choice:** BFF aggregate /api/health → **D-01**

### Cadence + states (follow-up)

| Option | Selected |
|--------|----------|
| ~15s; up/down/unknown (degraded = slow probe) | ✓ |
| ~15s; strictly up/down/unknown (no degraded) | |
| ~30s; up/down/unknown + slow=degraded | |

**Choice:** ~15s; up/down/unknown + slow→degraded → **D-02**

---

## Reconnect / backoff

| Option | Selected |
|--------|----------|
| Auto-reconnect w/ capped exponential backoff + jitter + manual retry | ✓ |
| Manual retry only (no auto) | |
| Auto-reconnect, linear fixed interval | |

**Choice:** Auto-reconnect, capped exponential backoff + jitter + manual retry; "Reconnecting (n/N)…"; stops on terminal; flow=/events-hydrate+de-dup, chat=re-open → **D-03**

---

## Five-state hardening scope

| Option | Selected |
|--------|----------|
| Audit + fix gaps + add disconnected/reconnecting | ✓ |
| Add disconnected/reconnecting only | |

**Choice:** Audit + fix gaps + add disconnected/reconnecting → **D-04**

---

## Claude's Discretion / Research

- memory-gateway reachability probe mechanism (/metrics scrape vs minimal request) + per-service probe timeout + parallel probe.
- exact reconnect cap (attempts/max delay) + backoff base + jitter.
- "slow" latency threshold for degraded.
- visibility-pause on hidden tab.
- /api/health BFF allowlist wiring.

## Deferred Ideas

- Deep metrics / Grafana dashboards — out of scope (top-line only).
- degraded-from-/readyz — not chosen (slow-probe degraded instead).
- operator-configurable backoff UI — not in scope (fixed cap).
