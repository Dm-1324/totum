# 0005: Permission spine: contract details, node:sqlite, grant rules

- Date: 2026-10-03
- Status: accepted
- Milestone: 2

## Context
Milestone 2 builds the capability contract, grant store, approvals and audit log.
The contract in `docs/architecture.md` left a few things open: how a tier-1 undo
finds what to reverse, how secrets stay out of the audit log, and how a capability
spec reaches processes that must not hold its implementation. Grants and the audit
log need SQLite, which normally means a native module rebuilt for Electron's ABI.

## Decision
**Contract** (`packages/shared/src/capability.ts`):
- Split into `CapabilitySpec` (id, tier, description, input and output zod schemas;
  any process may import it) and `Capability`, which adds `scopeOf`, `describe`,
  `run`, `verify`, `undo` and `redact` and is implemented only in `packages/host`.
- A successful `Result` may carry an `undo` token (JSON). The host stores it with
  the audit entry; `undo({ entryId, token })` returns a `Result` so it can refuse
  when the state changed since the call. Undo gets only the token (the stored input
  is redacted). The audit log never stores outputs.
- Optional `redact(input)` returns what the audit log stores.
- `Scope` is `folder { path } | app { app } | account { account }`.
- `Grant` lifetimes are `session | always`; `task` comes with tasks in milestone 3.

**Storage:** `node:sqlite` (`DatabaseSync`), built into Electron 44's Node 24.21.
Checked on 2026-10-03 with `ELECTRON_RUN_AS_NODE=1 electron.exe` (create, insert,
select); `host-db.process.test.ts` checks it inside the real utility process. The
DB file lives in `app.getPath('userData')`; main passes the path to host.

**Grant rules** (set by the user when approving the plan; enforced by the host engine):
- A call without a grant asks the user (host -> main -> ui). Denying, or no answer,
  fails with `not_granted`.
- The prompt names the exact scope, not just the capability.
- `always` is offered only for tier 0 and 1. Tier 2/3 grants last the session at
  most, and their calls still ask for approval every time.
- A call shaped by untrusted content says so in the prompt, gets no `always`, and
  needs approval as if it were tier 2.
- A denied grant is remembered for the rest of the task (same capability and scope
  fail without asking). At most 3 grant prompts per task; then `grant_prompt_limit`.

**Test capabilities** (`test.echo/note/danger/send`) are referenced only behind the
`__TOTUM_DEV__` build flag at process entry points, so production bundles drop them.

## Alternatives considered
- `better-sqlite3`: mature, but a native addon: electron-rebuild or prebuilds for
  Electron's ABI plus a second build for vitest under system Node.
- Storing outputs in the audit log so `undo` can read them: outputs can be large and
  untrusted (file contents); a small undo token is enough.
- Missing grant fails at once with `not_granted`, grants set up front in a panel:
  simpler engine, but every first use becomes a detour to settings.

## Consequences
No native modules yet, so no rebuild step and no ABI mismatch between Electron and
vitest. `node:sqlite` is release-candidate (stability 1.2) in Node 24; an Electron
upgrade must re-run `host-db.process.test.ts`. The `Capability` interface is now
the template for every milestone-4+ capability; changing it needs a new ADR.
