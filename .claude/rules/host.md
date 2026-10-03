---
paths:
  - "packages/host/**"
---

# packages/host rules

Host is the only process with OS access, so it carries the safety model.

- Every capability call goes through one path: validate input (zod) ->
  check grant + scope -> approval if tier >= 2 (or if flagged untrusted-derived)
  -> write audit entry (pending) -> run -> verify -> update audit entry.
  No capability is callable any other way. Never export `run` directly.
- Tier 1 capabilities must implement `undo`; `files.write` backs up the old file
  before writing.
- Approval requests carry `describe(input)` in plain words plus the exact
  command / recipient / account. Never ask approval for something vaguer than
  what will run.
- Approving once never makes a tier-3 action automatic.
- Output from files, commands, the web or email sets `untrusted: true`.
- Errors return `{ ok: false, code, message, hint }`; the hint tells the model
  what to do next. Never throw raw errors across IPC.
- Secrets (API keys, OAuth tokens) are stored with Electron `safeStorage`
  (Windows DPAPI), never in plain files or logs. Redact them from audit entries.
- `shell.execute` runs PowerShell (`pwsh` if present, else `powershell.exe`)
  with `-NoProfile`, in the granted working folder only.
- Use the `add-capability` skill for any new or changed capability.
