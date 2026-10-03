# 0001: Electron + TypeScript monorepo with process-per-package

- Date: 2026-10-03
- Status: accepted; the agent's process type is superseded by 0004
- Milestone: 0

## Context
Totum is a Windows desktop assistant whose safety model depends on one rule:
only one component may touch the OS. That rule must be enforced by structure,
not discipline, and checked automatically.

## Decision
Electron app, TypeScript strict everywhere, pnpm workspace with one package per
process: `main` (Electron main), `ui` (sandboxed renderer), `agent` and `host`
(Electron utility processes), plus `shared` (contract, zod IPC schemas, types).
Only `host` has OS access. Enforced by a Claude Code PostToolUse hook,
dependency-cruiser (`pnpm lint`) and the boundary-reviewer agent.

## Alternatives considered
- Tauri (Rust core): smaller binaries, but splits the codebase into two languages
  and slows iteration on the agent loop.
- Single-process Electron: simpler, but the one rule becomes a convention
  instead of a process boundary.
- Separate Node child processes instead of utility processes: same isolation,
  but more lifecycle code and no built-in MessagePort plumbing.

## Consequences
Every capability crosses IPC, so the shared schemas and contract are central
and changes to them need an ADR. Native modules (e.g. SQLite) must be built
against Electron's Node ABI. `node-linker=hoisted` in `.npmrc` avoids pnpm
symlink issues with Electron packaging on Windows.

## Note: TypeScript pinned to 6.0.x (2026-10-03)
dependency-cruiser 18 supports TypeScript `<7`. With TypeScript 7 installed,
`pnpm lint` silently skips TypeScript imports and misses violations (verified
with a planted `node:fs` import in packages/agent). Keep `typescript@~6.0`
until dependency-cruiser supports 7, then re-verify with a planted violation.

## Note: agent process type (2026-10-03)
The agent no longer runs as a utility process: Electron's utility process
ignores Node's `--permission` flag. It runs as a hidden sandboxed renderer.
See ADR 0004. Host stays a utility process.
