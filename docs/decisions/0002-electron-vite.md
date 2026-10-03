# 0002: electron-vite builds every process

- Date: 2026-10-03
- Status: accepted
- Milestone: 1

## Context
Totum has five bundles: Electron main, preload, a React renderer, the agent
and the host utility process. We want one build config and a dev loop with reload,
without writing our own bundling glue.

## Decision
`electron-vite` 5 (with `vite` 7), configured in `packages/main/electron.vite.config.ts`.
The renderer root is `packages/ui`; host is an extra entry in the main build.
The agent page and its preload have their own builds (see Consequences).

## Alternatives considered
- Plain esbuild scripts: fewer dependencies, but we'd write the dev server,
  reload and multi-entry wiring ourselves.

## Consequences
- `vite` stays on 7 until electron-vite supports 8 (its peer range is `^5 || ^6 || ^7`).
  vitest at the root brings its own vite 8; pnpm keeps them apart.
- pnpm 11 blocks install scripts. `pnpm-workspace.yaml` allows exactly `esbuild`
  and `electron` (`allowBuilds`).
- Electron 44 downloads its runtime lazily on first `require('electron')`, but
  electron-vite looks for `path.txt` directly, which only exists after that
  download. `pnpm dev` therefore runs `node -e "require('electron')"` first.
- The agent page and the agent preload are built outside electron-vite, by
  `agent.vite.config.ts` and `agent-preload.vite.config.ts`, each to a single
  file (ADR 0004). electron-vite's `isolatedEntries` (preload only) crashes when
  stdout isn't a TTY, and doesn't exist for main builds.
