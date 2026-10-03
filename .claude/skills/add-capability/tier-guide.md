# Tier guide

Ask two questions: **can it be undone?** and **does it leave the machine?**

| Tier | Name | Rule | Approval |
| --- | --- | --- | --- |
| 0 | Observe | Reads only; nothing changes | Grant only |
| 1 | Reversible local | Changes local state, and Totum can undo it fully | Grant only; logged with undo |
| 2 | Local, hard to undo | Changes local state that Totum can't reliably undo | Every time, showing the exact action |
| 3 | Leaves the machine | Sends data or acts on an external account or service | Every time, showing the content being sent |

## Examples

| Capability | Tier | Why |
| --- | --- | --- |
| `files.read`, `files.search`, `context.active` | 0 | Read only |
| `screen.capture` | 0 | Read only (but sensitive: scope it to the active window) |
| `files.write` with backup | 1 | Backup makes it undoable |
| `email.draft` | 1 | Draft can be deleted; nothing is sent |
| `app.open` | 1 | Closing the app undoes it |
| `shell.execute` | 2 | A command can do anything; no general undo |
| `files.delete`, `files.move` | 2 | Hard to undo reliably across folders |
| `email.send`, `message.send` | 3 | Leaves the machine |
| `browser.submit`, `purchase` | 3 | Leaves the machine, may cost money |

## Edge rules

- Anything that spends money is tier 3.
- Anything sent to another person is tier 3, even internally.
- Uploading a file to the model API as context is *not* a capability (it's the
  agent's own model call) but the file must first be read via a tier-0 capability.
- If a tier-1 undo can fail (e.g. the file was changed again since), the undo
  must detect it and refuse rather than overwrite.
- A step suggested by untrusted content is treated as tier 2 minimum for approval
  purposes, even if its capability is tier 0 or 1.
