# 0003: React UI, compiled by Vite's esbuild (no React plugin)

- Date: 2026-10-03
- Status: accepted
- Milestone: 1

## Context
The renderer will grow into a command bar, task view and approval dialogs
(milestones 2, 3, 6). It runs sandboxed under a strict CSP
(`script-src 'self'`), and it displays untrusted text (agent output, file
contents, email) that must never be rendered as HTML.

## Decision
React 19 for `packages/ui`, with JSX compiled by Vite's built-in esbuild
(`esbuild.jsx: "automatic"`). We do not use `@vitejs/plugin-react`.
Raw-HTML APIs (`dangerouslySetInnerHTML`, `innerHTML`, `document.write`, ...)
are banned in `packages/ui` by `scripts/check-no-raw-html.mjs`, run by `pnpm lint`.

## Alternatives considered
- Plain TypeScript + DOM: fewer dependencies, but approval dialogs and the task
  view would grow into a hand-rolled framework.
- `@vitejs/plugin-react`: gives fast refresh, but injects an inline preamble
  script in dev that `script-src 'self'` blocks, so the CSP would need
  loosening in dev. Not worth it; dev does full reloads instead.

## Consequences
- No hot module replacement for React components; edits reload the page.
- React escapes text by default; the lint check keeps the escape hatches out.
- UI tests run in jsdom with Testing Library (`// @vitest-environment jsdom`).
- `@totum/shared` keeps zod-free constants in `ipc/constants.ts` and is marked
  `"sideEffects": false`, so the preload and renderer don't bundle zod.
