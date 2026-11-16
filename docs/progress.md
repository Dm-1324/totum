# Progress

The handoff note between Claude Code sessions. Read it first; update it last
(`/handoff`). Keep it under ~60 lines: current state, not history.

## Current state

- Milestone 1 and 2 closed (M2: 2026-11-17). Last full run: 476 tests green (shared 119,
  host 110, agent 23, ui 62, main 162); typecheck and lint clean.
- Host: `node:sqlite`, `GrantStore`, `AuditLog`, `PermissionEngine` (the one path to `run`).
  Main stamps the task id; taint forces approval and bars `always`. After the boundary
  review (ADR 0007): main ignores approvals within 500 ms of a question; failed results
  can taint; calls refused before host are audited; 3 rejected approvals stop a task.
- Dev-only gating (`__TOTUM_DEV__`) is `mode === "development"`; the dev renderer URL is
  ignored when packaged; `production-build.test.ts` uses the real electron-vite config.
- 2026-11-13 planning (ADR 0006): UI becomes the island (`docs/island.md`, M4); milestone
  order and model guide in `docs/build-plan.md`; open-source picks in `docs/toolkit.md`.

## Next

Milestone 3 (agent loop) per `docs/build-plan.md`; start with `/milestone 3`.
The manual `pnpm dev` check (`docs/plans/m2-manual-check.md`: Enter on the tier-2 dialog
must reject; wait >10 s, chat must not time out) was not run by Claude: do it once.
Push to the private `Dm-1324/totum` repo (not on GitHub yet).

## Done

| Milestone | Date | Notes |
| --- | --- | --- |
| 0 Setup | 2026-10-03 | Context, skills, guardrails, workspace skeleton |
| 1 Process skeleton | 2026-10-03 | Typed IPC, supervised agent + host, agent in sandboxed renderer (ADRs 0002-0004) |
| 2 Permission spine | 2026-11-17 | Engine, grants, audit, dialogs, undo; boundary review done (ADRs 0005, 0007) |

## Open questions

- Model provider and model for the agent loop (decide in milestone 3; record an ADR).
- Speech-to-text: decided, local sherpa-onnx (ADR 0006, `docs/toolkit.md`).
- Trademark check for the name "Totum".

## Known issues and notes for later

- **Milestone 9 (hardening), from the M2 boundary review:**
  - Denied grants match the exact scope only, not anything inside it (ADR 0005).
  - `test.danger` approval text can understate what runs (note count changes while open); fix the pattern before M4 capabilities copy it.
  - Undo tokens skip redaction: document "no secrets in tokens" in the contract.
  - Rejected approvals have no same-action memory (only the 3-per-task cap).
- Taint (`AgentTaint`, `packages/main/src/router.ts`) lasts until the agent restarts, so
  after any untrusted read every call asks approval. M3: narrow it to a conversation reset.
- Folder scopes: drive-letter paths only (UNC refused: NTLM leak); links resolved before
  grant checks. M4 file capabilities must act on the canonical path (TOCTOU), see `grants.ts`.
- Approval dialog has no Edit yet (ui rules list Approve / Edit / Reject); planned for M5.
- Milestone 3: trim URLs from agent console logs (`agent-window.ts`); allow only the model
  API host in the agent CSP and session filter (`agent-request.ts`).
- Dev: agent code changes need an app restart (no watch for `agent*.vite.config.ts`).
- `agent-sandbox.test.ts` launches Electron (~10 s) and needs a desktop session.
- If a future milestone reloads chat history into a restarted agent, the taint must be
  restored with it.
- Packaging: disable DevTools in the UI window for production.
- M3: the agent drops unknown capability ids before sending, so host never audits them.
  Once the model calls capabilities, unknown ids must still be logged (send them, or log in main).
