# Progress

The handoff note between Claude Code sessions. Read it first; update it last
(`/handoff`). Keep it under ~60 lines: current state, not history.

## Current state

- Milestone 1 closed. Milestone 2 (permission spine): slices 1-6 landed (last: `16bbce1`,
  agent `/call`). Only slice 7 (close-out) remains. Last full run: 446 tests green.
- Host: `node:sqlite`, `GrantStore`, `AuditLog`, `PermissionEngine` (the one path to `run`)
  enforcing exact scope, `always` only tier 0/1 and never when untrusted-shaped, denials
  remembered per task, max 3 prompts per task.
- UI (slice 5): permission dialog (refusing button focused; Enter/Esc refuse), log panel
  with Undo, grant list with Revoke. Agent (slice 6): `/call` through the same
  capability path the model will use; dev builds only.
- 2026-11-13 planning (ADR 0006): UI becomes the island (`docs/island.md`, M4); new
  milestone order and model guide (`docs/build-plan.md`); open-source picks
  (`docs/toolkit.md`).

## Next

**Milestone 2, slice 7: close-out** (see `docs/plans/m2.md`). No `/milestone` needed.
Done when: a tier-2 call blocks until approved; every call appears in the log.
1. Manual `pnpm dev` check (script in slice 6's report; press Enter on the tier-2 dialog:
   it must reject; wait >10 s: chat must not time out).
2. `production-build.test.ts` (no `/call`, no `test.*` in production bundles),
   `host-db.process.test.ts`, add-capability skill text for "ask when missing".
3. `grants.test.ts`: run the real-junction test only on Windows
   (`it.runIf(process.platform === "win32")`).
4. Boundary-reviewer on the whole M2 diff; check the two best-guess fixes (main stamping
   the task id; taint).
Then milestone 3 (agent loop) per `docs/build-plan.md`.

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

- Security reviews ran in the background during slices 2-4; fixes are separate
  `m2:` commits. Several findings came without details, so fixes for "authorization"
  findings were best guesses (task id stamping, taint): worth a look from boundary-reviewer.
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
