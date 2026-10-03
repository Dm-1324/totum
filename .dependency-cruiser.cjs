/**
 * The one rule (see CLAUDE.md), enforced on every `pnpm lint`:
 * only packages/host may touch the OS.
 */
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "agent-no-node",
      severity: "error",
      comment:
        "packages/agent runs in a sandboxed renderer with no Node (ADR 0004) and never acts: " +
        "no Node built-ins at all. Request a capability from host over IPC.",
      from: { path: "^packages/agent/src" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "agent-no-electron",
      severity: "error",
      comment: "packages/agent runs in a sandboxed renderer and must not use Electron APIs (ADR 0004).",
      from: { path: "^packages/agent/src" },
      to: { path: "^electron$|node_modules/electron/" },
    },
    {
      name: "ui-no-os",
      severity: "error",
      comment: "The renderer is sandboxed; use the preload bridge (window.totum).",
      from: { path: "^packages/ui/src" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "ui-no-electron",
      severity: "error",
      comment: "The renderer must not import electron; use the preload bridge.",
      from: { path: "^packages/ui/src" },
      to: { path: "^electron$|node_modules/electron/" },
    },
    {
      name: "only-main-reaches-host",
      severity: "error",
      comment: "Nothing imports host internals. Host is reached only through IPC.",
      from: { path: "^packages/(agent|ui|shared)/" },
      to: { path: "^packages/host/|node_modules/@totum/host/" },
    },
    {
      name: "shared-is-pure",
      severity: "error",
      comment: "packages/shared holds types, schemas and pure functions only.",
      from: { path: "^packages/shared/src" },
      to: { dependencyTypes: ["core"] },
    },
    {
      name: "shared-depends-on-nothing-internal",
      severity: "error",
      from: { path: "^packages/shared/" },
      to: { path: "^packages/(agent|ui|main|host)/|node_modules/@totum/(agent|ui|main|host)/" },
    },
    {
      name: "no-circular",
      severity: "error",
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    exclude: { path: "(^|/)(dist|out|build)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    combinedDependencies: true,
  },
};
