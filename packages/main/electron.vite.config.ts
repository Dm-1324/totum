import { resolve } from "node:path";
import { defineConfig } from "electron-vite";

// One build for every process. The renderer lives in packages/ui; main only
// points at it. Agent and host entries join the main build in slice 3.
export default defineConfig({
  main: {
    build: {
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "src/index.ts") },
      },
    },
  },
  renderer: {
    root: resolve(import.meta.dirname, "../ui"),
    build: {
      outDir: resolve(import.meta.dirname, "out/renderer"),
      rollupOptions: {
        input: { index: resolve(import.meta.dirname, "../ui/index.html") },
      },
    },
  },
});
