import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const dir = import.meta.dirname;

// Builds main, the host utility process, the UI preload and the UI renderer.
// The agent page and its preload have their own single-file builds:
// agent.vite.config.ts and agent-preload.vite.config.ts (ADR 0004).
// Dependencies are bundled so no process loads anything from node_modules.
//
// __TOTUM_DEV__ is true for `electron-vite dev` and false for a production
// build; host registers the test capabilities only when it is true (ADR 0005).
export default defineConfig(({ mode }) => ({
  main: {
    define: { __TOTUM_DEV__: JSON.stringify(mode !== "production") },
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(dir, "src/index.ts"),
          host: resolve(dir, "../host/src/index.ts"),
        },
      },
    },
  },
  // Sandboxed preloads must be CommonJS and may only require "electron", so
  // everything else (the shared channel names) is bundled in.
  preload: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: { index: resolve(dir, "src/preload.ts") },
        output: { format: "cjs", entryFileNames: "[name].cjs" },
      },
    },
  },
  renderer: {
    root: resolve(dir, "../ui"),
    // JSX through Vite's esbuild; no React plugin, so no inline dev preamble
    // that the renderer's CSP (script-src 'self') would have to allow.
    esbuild: { jsx: "automatic" },
    build: {
      outDir: resolve(dir, "out/renderer"),
      rollupOptions: {
        input: { index: resolve(dir, "../ui/index.html") },
      },
    },
  },
}));
