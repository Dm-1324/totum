# Progress

The handoff note between Claude Code sessions. Read it first; update it last
(`/handoff`). Keep it under ~60 lines: current state, not history.

## Current state

- Milestone 1 closed. Milestone 2 (permission spine) is **half done**: slices 1-4 of
  `docs/plans/m2.md` landed; 5-7 remain. 374 tests green; typecheck and lint clean.
- Contract in `packages/shared/src/capability.ts` (ADR 0005). Host has SQLite via
  `node:sqlite` (no native module), `GrantStore`, `AuditLog`, and `PermissionEngine`, the
  one path to `run`, enforcing the user's grant rules (exact scope, `always` only tier 0/1
  and never when untrusted-shaped, denials remembered per task, max 3 prompts per task).
- `test.echo/note/danger/send` registered only under `__TOTUM_DEV__` (absent from
  production bundles; checked by hand, test due in slice 7).
- IPC: agent -> main -> host capability calls; host -> main -> ui permission asks;
  ui -> main -> host log/grant queries. Main stamps the task id (the one chat message in
  flight; else `no_task`), holds the agent's chat timeout while an ask is open, expires
  asks after 5 min, and marks the agent tainted once untrusted content reaches it.
- Done-when proven in tests only: `packages/main/src/permission-flow.test.ts`. Not yet in
  the running app: there is no dialog or log UI (slice 5) and no `/call` trigger (slice 6).

## Next

**Milestone 2, slices 5-7** (see `docs/plans/m2.md`). No `/milestone` needed; read the plan.
Done when: a tier-2 call blocks until approved; every call appears in the log.
- 5: permission dialog + log panel + grant list in `packages/ui`. Preload API and
  `fakeApi()` (`packages/ui/src/fake-api.ts`) exist. Subscribe to `onPermissionAsk` in
  `main.tsx` before render (an ask sent before React mounts is otherwise missed;
  main re-shows open asks on `did-finish-load`).
- 6: agent `/call`, built on `AgentCall` / `AgentCapabilityRequest` (no task id).
- 7: `production-build.test.ts`, `host-db.process.test.ts`, manual `pnpm dev` check,
  add-capability skill text for "ask when missing", boundary-reviewer on the whole M2 diff.

## Done

| Milestone | Date | Notes |
| --- | --- | --- |
| 0 Setup | 2026-10-03 | Context, skills, guardrails, workspace skeleton |
| 1 Process skeleton | 2026-10-03 | Typed IPC, supervised agent + host, agent in sandboxed renderer (ADRs 0002-0004) |

## Open questions

- Model provider and model for the agent loop (decide in milestone 3; record an ADR).
- Speech-to-text provider (decide in milestone 6).
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
