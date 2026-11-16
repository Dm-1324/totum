// Milestone 2: test capabilities and the dev-only /call parser must not exist
// in production bundles. Builds the real host and agent entries in production
// mode into temp folders (never packages/main/out) and searches the output,
// which proves tree-shaking, not just that the flag is false. A development
// build of the same entries is the control: the markers must be found there,
// or the search proves nothing.
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const mainDir = join(import.meta.dirname, "..");
const hostEntry = join(mainDir, "..", "host", "src", "index.ts");

/** Strings that exist only because of the test capabilities or /call. */
const HOST_MARKERS = ["test.danger", "test.send", "test.note", "test.echo", "totum-test-outbox"];
const AGENT_MARKERS = ["test.danger", "test.send", "Usage: /call"];

type Mode = "production" | "development";

let work: string;
let hostProd: string;
let hostDev: string;
let agentProd: string;
let agentDev: string;

function readTree(dir: string): string {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(e.parentPath, e.name), "utf8"))
    .join("\n");
}

async function buildHost(mode: Mode): Promise<string> {
  const outDir = join(work, `host-${mode}`);
  await build({
    configFile: false,
    mode,
    logLevel: "warn",
    define: { __TOTUM_DEV__: JSON.stringify(mode === "development") },
    build: {
      ssr: hostEntry,
      outDir,
      target: "esnext",
      rollupOptions: { external: ["electron", /^node:/], output: { format: "es" } },
    },
    ssr: { noExternal: true, external: ["electron"] },
  });
  return readTree(outDir);
}

/** The real agent config; only the output folder is redirected. */
async function buildAgent(mode: Mode): Promise<string> {
  const outDir = join(work, `agent-${mode}`);
  await build({
    configFile: join(mainDir, "agent.vite.config.ts"),
    mode,
    logLevel: "warn",
    build: { outDir, emptyOutDir: true },
  });
  return readTree(outDir);
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "totum-prod-build-"));
  hostProd = await buildHost("production");
  hostDev = await buildHost("development");
  agentProd = await buildAgent("production");
  agentDev = await buildAgent("development");
}, 180_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("production bundles", () => {
  it.each(HOST_MARKERS)("control: the development host contains %s", (marker) => {
    expect(hostDev).toContain(marker);
  });

  it.each(AGENT_MARKERS)("control: the development agent contains %s", (marker) => {
    expect(agentDev).toContain(marker);
  });

  it.each(HOST_MARKERS)("the production host leaves out %s", (marker) => {
    expect(hostProd).not.toContain(marker);
  });

  it.each(AGENT_MARKERS)("the production agent leaves out %s", (marker) => {
    expect(agentProd).not.toContain(marker);
  });

  it("the production builds are real code, not empty output", () => {
    expect(hostProd.length).toBeGreaterThan(1_000);
    expect(agentProd.length).toBeGreaterThan(1_000);
  });
});
