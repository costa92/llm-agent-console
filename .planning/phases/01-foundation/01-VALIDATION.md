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

---

## Sampling Rate

- **After every task commit:** Run the quick run command for the touched surface.
- **After every plan wave:** Run the full suite command.
- **Before `/gsd:verify-work`:** Full suite green, including the SSE-proof script.
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

> Filled by the planner/executor — one row per task, mapping to a requirement + automated command.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| _(to be filled during planning)_ | | | | | | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Go module + `httptest`-based test scaffold for the BFF (header-strip + SSE pass-through seams).
- [ ] `web/` Vite + Vitest scaffold.
- [ ] `scripts/sse-proof.sh` — the BFF-03 keystone proof (`curl -N` through nginx, compression on).

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
