import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

const dir = import.meta.dirname;

// One build for every process. The renderer lives in packages/ui; main only
// points at it. Agent and host are extra entries of the main build, with all
// dependencies bundled so no process loads anything from node_modules at runtime.
// Entries share chunks (zod, schemas) under out/main/chunks.
export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      rollupOptions: {
        input: {
          index: resolve(dir, "src/index.ts"),
          agent: resolve(dir, "../agent/src/index.ts"),
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
});
