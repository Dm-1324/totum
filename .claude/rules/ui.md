---
paths:
  - "packages/ui/**"
  - "packages/main/src/preload*"
---

# packages/ui rules

- The renderer is sandboxed: `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`. Never relax these.
- The renderer talks only to the narrow API exposed by the preload script
  (`window.totum`). No Node, no `electron`, no `@totum/host` imports.
- The preload exposes named, typed functions only; never a generic
  `send(channel, data)` or `ipcRenderer` passthrough.
- Approval dialogs show exactly what host sent: the plain-words description,
  the exact command / recipient / sending account, and Approve / Edit / Reject.
  The UI never decides on approval itself and never auto-approves.
- Render untrusted content as text, never as HTML.
- The task view always shows the current plan, live steps and a working Stop button.
