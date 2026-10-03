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
    // Allow-lists close the indirect paths: agent and ui may import only their
    // own files, @totum/shared and the npm packages named here. Importing
    // packages/main (which may use Node) or any new npm package fails until it
    // is added on purpose. shared-is-pure keeps shared itself free of Node.
    {
      name: "agent-allowed-imports",
      severity: "error",
      comment:
        "packages/agent may import only its own files, @totum/shared and zod. " +
        "Anything else (packages/main, a new npm package) needs a deliberate change here.",
      from: { path: "^packages/agent/src", pathNot: "\\.test\\.tsx?$" },
      to: { pathNot: "^packages/(agent|shared)/|node_modules/zod/" },
    },
    {
      name: "ui-allowed-imports",
      severity: "error",
      comment:
        "packages/ui may import only its own files, @totum/shared, react and react-dom. " +
        "Anything else (packages/main, a new npm package) needs a deliberate change here.",
      from: { path: "^packages/ui/src", pathNot: "\\.test\\.tsx?$" },
      to: { pathNot: "^packages/(ui|shared)/|node_modules/(react|react-dom|zod)/" },
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
      // agent and ui may import shared freely, so shared needs its own allow-list,
      // or a new npm dependency here would reach both unchecked.
      name: "shared-allowed-imports",
      severity: "error",
      comment: "packages/shared may import only its own files and zod. A new dependency needs a deliberate change here.",
      from: { path: "^packages/shared/src", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^packages/shared/|node_modules/zod/" },
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
    // Only our own build output; npm packages often ship from dist/ and must stay visible.
    exclude: { path: "^packages/[^/]+/(dist|out|build)/" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.base.json" },
    combinedDependencies: true,
  },
};
