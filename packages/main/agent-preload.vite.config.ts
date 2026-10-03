import { resolve } from "node:path";
import { defineConfig } from "vite";

const dir = import.meta.dirname;

// The agent window's preload (ADR 0004): one CommonJS file that requires only
// "electron", as a sandboxed preload must. Built on its own because
// electron-vite's isolatedEntries crashes when stdout isn't a TTY.
export default defineConfig({
  logLevel: "warn",
  build: {
    outDir: resolve(dir, "out/agent-preload"),
    emptyOutDir: true,
    target: "esnext",
    minify: false,
    lib: {
      entry: resolve(dir, "src/agent-preload.ts"),
      formats: ["cjs"],
      fileName: () => "agent.cjs",
    },
    rollupOptions: { external: ["electron"] },
  },
});
