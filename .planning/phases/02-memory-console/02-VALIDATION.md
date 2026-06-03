---
phase: 2
slug: memory-console
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `02-RESEARCH.md` §Validation Architecture (verified against the gateway contract).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.x + @testing-library/react (locked Phase-1 stack) |
| **Config file** | established in Phase 1 — **Wave 0 if absent** (verify, don't duplicate) |
| **Quick run command** | `npm run test -- src/features/memory --run` |
| **Full suite command** | `npm run test -- --run` |
| **Estimated runtime** | ~15 seconds (component + unit, no e2e) |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- src/features/memory --run`
- **After every plan wave:** Run `npm run test -- --run`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~15 seconds

---

## Per-Task Verification Map

> Task IDs are assigned by the planner; rows below are keyed to requirements +
> the behavior under test (from RESEARCH §Phase Requirements → Test Map). The
> planner/executor maps each to a concrete `{2}-{plan}-{task}` id and `<automated>` verify.

| Req | Wave (slice) | Behavior under test | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-----|-------------|---------------------|------------|-----------------|-----------|-------------------|-------------|--------|
| MEM-01 | A (recall→render) | Recall renders ranked hits w/ score + metadata; empty→empty-state | — | Render gateway strings as text nodes (no `dangerouslySetInnerHTML`) | component | `vitest src/features/memory/ResultsTable.test.tsx --run` | ❌ W0 | ⬜ pending |
| MEM-01 | A | Client-side sort/page/filter over top-k (no server re-query; recall has no sort/offset) | — | N/A | component | `vitest src/features/memory/ResultsTable.test.tsx --run` | ❌ W0 | ⬜ pending |
| MEM-02 | B (drawer) | `?item={id}` opens drawer; GET item renders fields + raw JSON viewer | — | Raw JSON shown as escaped text | component | `vitest src/features/memory/ItemDrawer.test.tsx --run` | ❌ W0 | ⬜ pending |
| MEM-03 | C (lifecycle) | Write: zod rejects empty content / bad kind before submit | T-V5 | zod client-validate; gateway authoritative | unit | `vitest src/features/memory/schemas.test.ts --run` | ❌ W0 | ⬜ pending |
| MEM-04 | C | Patch sends `expected_version`; refetches GET item on success (lean response) | T-V4 | scope `{}`; only `X-Console-*` | unit | `vitest src/features/memory/useMemoryMutations.test.ts --run` | ❌ W0 | ⬜ pending |
| MEM-05 | C | Pin/unpin reflects `{pinned,version}` from response via `setQueryData` | — | N/A | unit | `vitest src/features/memory/useMemoryMutations.test.ts --run` | ❌ W0 | ⬜ pending |
| MEM-06 | C | Disable shows **neutral** confirm; enable fires no confirm | — | N/A | component | `vitest src/features/memory/LifecycleActions.test.tsx --run` | ❌ W0 | ⬜ pending |
| MEM-07 | C | Delete shows **red destructive** confirm; pessimistic remove-after-200 | — | Confirm-on-destructive (operator-error guard) | component | `vitest src/features/memory/LifecycleActions.test.tsx --run` | ❌ W0 | ⬜ pending |
| MEM-07 | C | `409 memory_conflict` surfaces + triggers item refetch (OCC recovery) | — | Stale-version recovery is first-class | unit | `vitest src/features/memory/useMemoryMutations.test.ts --run` | ❌ W0 | ⬜ pending |
| MEM-08 | A | Unset tenant/user → full-page block, **no requests fired** | T-V4 | Gate before any gateway call | component | `vitest src/features/memory/MemoryPage.test.tsx --run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/features/memory/api/schemas.ts` — zod schemas/fixtures derived from the golden JSON shapes in RESEARCH (reusable as test fixtures: recall response, item record, mutation responses, 409 envelope)
- [ ] `src/test/mocks/memory-gateway.ts` — fetch/MSW handlers returning the documented contract shapes, **including a 409 conflict case and an empty-hits case**
- [ ] Vitest config + `@testing-library/react` setup — **only if Phase 1 did not already establish it** (it should have; verify, don't duplicate)
- [ ] Shared `QueryClient` test wrapper — reuse the Phase 1 wrapper if present; create only if absent

*If Phase 1 established Vitest + RTL + a QueryClient test wrapper, only the memory-specific fixtures/mocks and test files are new.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Drawer URL-restore across a real browser reload | MEM-02 | localStorage/URL + reload round-trip is integration-grade; component test covers the param→open logic | In the running SPA: open an item (drawer), copy URL, reload — drawer reopens to the same item |
| Operator-context gate against the live BFF | MEM-08 | Requires the executed Phase-1 BFF + a real gateway to confirm no doomed request fires | Unset tenant/user in the context bar → Memory page shows full-page block; Network panel shows zero `/api/memory/*` calls |

*Component tests cover the logic; these two confirm the integration round-trip a unit test can't.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
