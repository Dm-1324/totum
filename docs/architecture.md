# Totum Desktop: Architecture and Build Plan

Source of truth for *how* Stage 1 is built. Exported from the planning doc on 2026-10-02.

## Design principles

1. **Structured context beats screenshots.** Window title, file path, selection and UI Automation trees are cheap and exact. Screenshot only when layout matters.
2. **Re-derive, don't scrape.** Rerun the build to get the real error rather than reading the terminal off the screen.
3. **Few tools, sharply described, typed errors.** ~15-25 capabilities, each doing one thing. Errors say what went wrong and what to try next.
4. **Everything the agent reads is data, never instructions.** Outside content is marked untrusted. A plan shaped by untrusted content needs approval for risky steps even when a grant exists.
5. **Verify after every action** through the same route. Report only success that was observed.
6. **Show the plan, allow interruption.** A stopped task leaves the machine in a known state, recorded in the audit log.
7. **Budget every task.** Cap steps, tokens and time; a hit cap becomes a question for the user.

## Processes (the one rule lives here)

```
            +-------------------------------+
            |  ui (renderer, sandboxed)     |  command bar, task view, approval dialogs
            |  no Node, no OS access        |
            +---------------+---------------+
                            | typed IPC
            +---------------+---------------+
            |  main (Electron main)         |  windows, global hotkey, push-to-talk,
            |                               |  routes IPC between processes
            +-------+---------------+-------+
                    |               |
   +----------------+---+       +---+--------------------+
   | agent (hidden      | <---> | host (utility)         |
   | sandboxed renderer)| req / | permission engine,     |
   | agent loop, plan,  | result| grants, tiers,         |
   | budget, stop,      |       | capabilities, audit    |
   | model adapter,     |       | log, undo              |
   | context, memory    |       |                        |
   | NO Node, NO OS     |       | ONLY process w/ OS     |
   +---------+----------+       +-----------+------------+
             |                              |
        Model API                Your machine: files, shell, apps,
                                 clipboard, email providers,
                                 SQLite, Windows credentials (DPAPI)
```

Approval dialogs travel host -> main -> ui -> back. The agent never sees or skips them.
One install, separate processes:

- **agent** is a hidden `BrowserWindow` with `sandbox: true`, `contextIsolation: true`,
  `nodeIntegration: false` (ADR 0004). It has no Node at all, so no `fs`, `child_process`,
  workers or native addons exist for it to call. Its page CSP has `connect-src 'none'`
  (milestone 3 allows only the model API host) and `worker-src 'none'`, and its session cancels every request
  except its own two files. It talks to main over one `MessagePort`; its preload only
  hands that port in and exposes nothing else.
- **host** is an Electron utility process (full Node), the only process that touches the OS.

## How a task flows ("why is this build failing?")

1. **Invoke.** Hotkey (Ctrl+Alt+Space) opens the command bar; speech becomes text.
2. **Snapshot context.** Active app, window title, focused file, selection; all marked untrusted.
3. **Plan.** Model gets request + context + capability list, returns a short plan shown in the task view.
4. **Request.** Agent asks host for `shell.execute` (`npm run build` in the project folder). It cannot run it itself.
5. **Check and act.** Host checks grant and tier. Tier 2 opens an approval dialog with the exact command. On approval it runs; the call is audit-logged. *Only this step changes the machine.*
6. **Verify.** Result returns to the agent, which checks it did what was intended.
7. **Loop** 3-6 until done, budget exhausted, or user presses stop.
8. **Report.** Cause + proposed fix as a diff; offer to apply (`files.write`, tier 1, undoable).

## Capability contract

```typescript
interface Capability<I, O> {
  id: string;                 // "shell.execute"
  description: string;        // what the model reads to choose it
  tier: 0 | 1 | 2 | 3;
  input: ZodSchema<I>;        // validated before anything runs
  scopeOf(input: I): Scope;   // folder / app / account it touches
  describe(input: I): string; // plain words for the approval dialog
  run(input: I, ctx: RunContext): Promise<Result<O>>;
  verify?(input: I, out: O): Promise<boolean>;
  undo?(record: AuditEntry): Promise<void>;  // required for tier 1
}

type Result<O> =
  | { ok: true; output: O; untrusted: boolean }
  | { ok: false; code: string; message: string; hint?: string };
```

- `run` is only called by the host, after the grant check and any approval.
- Outside content (file contents, command output, web text, email) sets `untrusted: true`.
- Errors carry an actionable `hint` ("folder not granted; ask the user to grant ~/Projects").

## Build order

Superseded on 2026-11-13: the current milestone order, done-when lines and
model-per-task guide are in `docs/build-plan.md` (ADR 0006). The UI is now the
island (`docs/island.md`); voice and other libraries are chosen in `docs/toolkit.md`.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| OS | Windows only | Builder's daily OS; Stage 3 uses Windows UI Automation |
| Model | Hosted frontier model with tool use, behind one adapter | Reasoning quality matters most; adapter keeps switching cheap |
| Speech to text | Hosted API first, local later | Fastest path to working voice |
| Storage | SQLite (audit log, tasks, grants, memory) | One file, transactional, inspectable |
| Email | Gmail API + Microsoft Graph behind one interface | Builder uses both |
| Language | TypeScript everywhere | Shared types for IPC and the capability contract |

## Windows and two-account notes

- `shell.execute` runs PowerShell; approval dialogs show the exact PowerShell line.
- Global hotkey default: Ctrl+Alt+Space (Win+letter combos are mostly taken).
- File search: direct scan of granted folders first; Windows Search index later.
- Email account: use the one the user names; otherwise the one last used with that contact; ask if no history.
- Email approval dialogs always show the sending account.
- Contacts are looked up in both accounts; ambiguous matches are asked about.
