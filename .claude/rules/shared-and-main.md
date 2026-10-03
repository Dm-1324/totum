---
paths:
  - "packages/shared/**"
  - "packages/main/**"
---

# packages/shared and packages/main rules

## shared

- Types, zod schemas and pure functions only. No OS access, no side effects,
  no imports from other `@totum/*` packages.
- Every IPC message is a zod schema here; both ends import the inferred type.
- The capability contract lives in `src/capability.ts`. Changing it is an ADR.

## main

- Main creates windows, registers the global hotkey (default Ctrl+Alt+Space),
  handles push-to-talk, spawns `agent` and `host` as Electron utility processes,
  and routes IPC between them and the renderer.
- Main does not implement capabilities and does not decide approvals. It
  forwards approval requests from host to ui and the answers back.
- Validate every message crossing a process boundary against its shared schema.
