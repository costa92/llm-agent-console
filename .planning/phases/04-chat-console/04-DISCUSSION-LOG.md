# Phase 4: Chat Console - Discussion Log

> **Audit trail only.** Not consumed by downstream agents — decisions live in CONTEXT.md.

**Date:** 2026-06-04
**Phase:** 4-chat-console
**Areas discussed:** Conversation + agent-step rendering, Session continuity & management, Sync vs streamed, Compose / input UX

---

## Conversation + agent-step rendering

| Option | Selected |
|--------|----------|
| Bubbles + collapsible inline step trace (reuse Phase-3 renderer) | ✓ |
| Bubbles + always-expanded steps | |
| Operator transcript (no bubbles) | |

**Choice:** Bubbles + collapsible inline step trace → **D-01**

---

## Session continuity & management

| Option | Selected |
|--------|----------|
| Single active session + 'New session' (id shown, no history) | ✓ |
| Tie to operator-context session field | |
| Session list / switcher | |

**Choice:** Single active session + New session → **D-02** (+ D-06 clear-on-new)

---

## Sync vs streamed

| Option | Selected |
|--------|----------|
| Streamed default + sync toggle, same bubble | ✓ |
| Two send buttons (Send / Send streamed) | |
| Streamed only + auto-fallback to sync | |

**Choice:** Streamed default + sync toggle, one bubble → **D-03**

---

## Compose / input UX

| Option | Selected |
|--------|----------|
| Multi-line, Enter-sends + Stop button | ✓ |
| Button-only send, Enter = newline | |
| Enter-sends, no stop | |

**Choice:** Multi-line, Enter-sends + Stop → **D-04**

---

## Follow-ups

| Question | Choice | → |
|----------|--------|---|
| Stop mid-response | Keep partial + 'Stopped' marker (conn→closed, not error) | **D-05** |
| New session view | Clear to a fresh empty conversation | **D-06** |

---

## Claude's Discretion / Research

- Exact `/chat` + `/chat/stream` contract: agent-step frame schema + session_id mechanic (verify against `../llm-agent-customer-support/internal/httpapi/httpapi.go`).
- Phase-3 SSE-infra reuse-vs-adapt (generic stream hook + chat reducer, or thin wrapper over useRunStream).
- Step-trace collapse/re-expand + sync/stream toggle placement + streaming/Stopped/error visuals (per UI-SPEC).

## Deferred Ideas

- Session-history list/switcher — no browse endpoint (v1 single session).
- Reconnect/backoff — Phase 5.
- Keep prior transcript across New session — not chosen (D-06 clears).
