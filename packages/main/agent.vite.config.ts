import { resolve } from "node:path";
import { defineConfig } from "vite";

const dir = import.meta.dirname;

// The agent page (ADR 0004): exactly out/agent/index.html + out/agent/agent.js.
// One script, every dependency inlined, no module-preload helper, no other
// assets, so the page CSP (script-src 'self') and the session filter
// (files in out/agent only) describe everything the agent can load.
export default defineConfig({
  root: resolve(dir, "../agent"),
  base: "./",
  logLevel: "warn",
  build: {
    outDir: resolve(dir, "out/agent"),
    emptyOutDir: true,
    modulePreload: false,
    target: "esnext",
    rollupOptions: {
      input: resolve(dir, "../agent/index.html"),
      output: { entryFileNames: "agent.js", inlineDynamicImports: true },
    },
  },
});
