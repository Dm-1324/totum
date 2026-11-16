# Progress

The handoff note between Claude Code sessions. Read it first; update it last
(`/handoff`). Keep it under ~60 lines: current state, not history.

## Current state

- Milestone 1 closed. Milestone 2 (permission spine) code-complete: slices 1-7 landed;
  boundary review passed (0 blockers). Last full run: 466 tests green (shared 119, host 104,
  agent 22, ui 62, main 159); typecheck and lint clean.
- Host: `node:sqlite`, `GrantStore`, `AuditLog`, `PermissionEngine` (the one path to `run`).
  Main stamps the task id; taint forces approval and bars `always` (both reviewed, sound).
- Dev-only gating (`__TOTUM_DEV__`) is now `mode === "development"`; the dev renderer URL
  is ignored when packaged.
- 2026-11-13 planning (ADR 0006): UI becomes the island (`docs/island.md`, M4); new
  milestone order and model guide (`docs/build-plan.md`); open-source picks (`docs/toolkit.md`).

## Next

**Close M2 by hand:** run the manual `pnpm dev` check in `docs/plans/m2-manual-check.md`
(Enter on the tier-2 dialog must reject; wait >10 s: chat must not time out). Done when:
a tier-2 call blocks until approved; every call appears in the log.
Then decide which boundary-review should-fixes go before M3 (list below), and start M3
(agent loop) per `docs/build-plan.md`.

## Done

| Milestone | Date | Notes |
| --- | --- | --- |
| 0 Setup | 2026-10-03 | Context, skills, guardrails, workspace skeleton |
| 1 Process skeleton | 2026-10-03 | Typed IPC, supervised agent + host, agent in sandboxed renderer (ADRs 0002-0004) |

## Open questions

- Model provider and model for the agent loop (decide in milestone 3; record an ADR).
- Speech-to-text: decided, local sherpa-onnx (ADR 0006, `docs/toolkit.md`).
- Trademark check for the name "Totum".

## Known issues and notes for later

- Boundary review of M2 (should-fix, none blocking):
  1. Calls refused before host (`no_task`, unknown id) are not audited.
  2. Rejected approvals have no per-task memory or cap (approval-prompt fatigue).
  3. Next permission dialog mounts with Approve live under the cursor (double-click risk):
     add a ~500 ms disable.
  4. Denied grants match the exact scope only, not anything inside it (ADR 0005).
  5. Failed results never set the taint (see failed-results note below).
  6. `production-build.test.ts` builds host with an inline config, not the real one.
  7. `test.danger` approval text can understate what runs (count changes while open).
  8. Undo tokens skip redaction: document "no secrets in tokens" in the contract.

- Taint (`AgentTaint`, `packages/main/src/router.ts`) lasts until the agent restarts, so
  after any untrusted read every call asks approval. M3: narrow it to a conversation reset.
- Failed results carry no `untrusted` flag: error messages must stay host-written, never
  quote file or command text, or the contract needs a flag on errors (M4/M5).
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
- Not on GitHub yet: push to the private `Dm-1324/totum` repo as soon as it exists.
