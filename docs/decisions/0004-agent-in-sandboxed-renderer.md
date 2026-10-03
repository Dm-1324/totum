# 0004: The agent runs in a hidden sandboxed renderer

- Date: 2026-10-03
- Status: accepted (supersedes the agent's process type in 0001)
- Milestone: 1

## Context
Milestone 1 closes when "the agent has no way to touch the filesystem". Lint
and the boundary hook stop forbidden imports, but that is discipline; we want
the runtime itself to make OS access impossible. The plan was to run the agent
as an Electron utility process under Node's permission model (`--permission`,
read access to its own bundle only).

A spike (2026-10-03, Electron 44.5.1 / Node 24.21.0) tested that. A utility
process allowed to read only its own file tried to read the repo's `package.json`:

| How `--permission` was passed | Flag reached the process | Permission API active | Read of `package.json` |
| --- | --- | --- | --- |
| No sandbox (baseline) | n/a | no | succeeded |
| `execArgv: ["--permission", "--allow-fs-read=<probe>"]` | yes (`process.execArgv`) | no (`process.permission` undefined) | succeeded |
| `execArgv: ["--experimental-permission", ...]` | yes | no | succeeded |
| `NODE_OPTIONS="--permission --allow-fs-read=<probe>"` | yes | API present, reported the read as allowed | succeeded |

Electron's utility process accepts the flags but does not enforce them.

## Decision
The agent runs in a hidden `BrowserWindow` (`show: false`) with `sandbox: true`,
`contextIsolation: true`, `nodeIntegration: false`, `backgroundThrottling: false`,
no devtools, no webview, no spellcheck, in its own in-memory session
(`packages/main/src/agent-window.ts`, `agentWindowOptions`).

- **No Node:** `require`, `process`, `Buffer`, `module` don't exist, so file
  access, child processes, workers and native addons have nothing to call.
- **No network:** the page CSP is `default-src 'none'; script-src 'self';
  connect-src 'none'`. As a second layer, the agent session's `webRequest` filter
  cancels every request except files in `out/agent/`, and every permission request
  is refused. Milestone 3 will allow exactly the model API host in both layers.
- **One channel:** main hands the page one `MessagePort` through a preload that
  exposes nothing else. The page accepts only the first port.
- **Fixed code:** the page is exactly `out/agent/index.html` + `out/agent/agent.js`
  (`agent.vite.config.ts`); the preload is one CommonJS file
  (`agent-preload.vite.config.ts`). The window can't navigate or open windows.
- **Same lifecycle:** the window is adapted to the supervisor's `Child`. A renderer
  crash or failed load is an exit (restart with backoff, give up after 3 in 60 s);
  `stop()` destroys the window.

Proof: `packages/main/src/agent-sandbox.test.ts` builds the real agent page and
preload, starts the agent with `createAgentChild` (the same code main uses) in
real Electron, and checks from inside the page that the Node globals are
undefined and every fetch fails. It also checks that a window with
`nodeIntegration` running the same probe does see Node and does reach the local
server, so the test can detect a leak.

## Alternatives considered
- Utility process + Node `--permission`: ignored by Electron (table above). Even
  where it works, Node documents the permission model as not a security boundary
  against malicious code.
- Plain Node child process via `ELECTRON_RUN_AS_NODE` + `--permission`: not tried.
  `ELECTRON_RUN_AS_NODE` is a fuse we will disable for production, and the
  permission model still isn't a security boundary.
- Lint only: catches imports, not a runtime escape.

## Consequences
- Chromium's sandbox is enforced by the OS (restricted token, job object on
  Windows); a renderer also lets us restrict network per session.
- The agent is heavier (a Chromium renderer) and talks over a MessagePort instead
  of a utility-process port. `packages/agent` is browser code: DOM lib, no Node
  types, and `pnpm lint` forbids every Node built-in there (`agent-no-node`).
- Agent console output reaches main's log through `console-message`.
- The hidden window doesn't keep the app open: closing the UI window quits.
- `pnpm dev` rebuilds the agent page once at start; agent edits need a restart.
