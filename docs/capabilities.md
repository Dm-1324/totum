# Capabilities

The registry of every capability, its tier and status. Update this file whenever
a capability is added or changed (the `add-capability` skill does this).

Tiers: 0 observe · 1 reversible local · 2 local, hard to undo · 3 leaves the machine.

## Stage 1: must have

| Capability | Tier | Milestone | Status |
| --- | --- | --- | --- |
| `context.active` (app, window title, selection, focused file) | 0 | 4 | planned |
| `screen.capture` (active window) | 0 | 4 | planned |
| `files.list` | 0 | 4 | planned |
| `files.search` (name, type, modified date) | 0 | 4 | planned |
| `files.read` | 0 | 4 | planned |
| `clipboard.read` | 0 | 4 | planned |
| `clipboard.write` | 1 | 4 | planned |
| `files.write` (automatic backup) | 1 | 5 | planned |
| `app.open` | 1 | 5 | planned |
| `shell.execute` (PowerShell, scoped folder) | 2 | 5 | planned |
| `email.draft` (Gmail, Outlook) | 1 | 7 | planned |
| `contacts.lookup` (both accounts) | 0 | 7 | planned |

## Stage 1: should have

| Capability | Tier | Status |
| --- | --- | --- |
| `ui.read` (Windows UI Automation tree) | 0 | later |
| `files.contentSearch` | 0 | later |
| `files.move`, `files.rename` | 2 | later |

## Could have / later stages

| Capability | Tier |
| --- | --- |
| `email.send`, `message.send` | 3 |
| `calendar.read` / `calendar.create` | 0 / 3 |
| `browser.*` (Stage 2) | 0-3 |
| `keyboard.type`, `mouse.control` (Stage 3) | 2 |

## Test capabilities (milestone 2; dev and test builds only)

Registered only when `__TOTUM_DEV__` is true; production bundles leave them out.
They touch only Totum's own database (`test_notes`, `test_outbox`).

| Capability | Tier | Scope | Purpose | Status |
| --- | --- | --- | --- | --- |
| `test.echo` | 0 | app `totum-test` | Exercises the grant path | done |
| `test.note` | 1 | app `totum-test-notes` | Exercises audit + undo | done |
| `test.danger` | 2 | app `totum-test-notes` | Exercises the approval dialog (clears notes) | done |
| `test.send` | 3 | account `totum-test-outbox` | Exercises the tier-3 dialog (local outbox only) | done |
