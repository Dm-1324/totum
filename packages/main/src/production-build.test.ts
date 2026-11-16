// Milestone 2: test capabilities and the dev-only /call parser must not exist
// in production bundles. Builds main and host with the real electron.vite.config.ts
// and the agent with the real agent.vite.config.ts, in production
// mode into temp folders (never packages/main/out) and searches the output,
// which proves tree-shaking, not just that the flag is false. A development
// build of the same entries is the control: the markers must be found there,
// or the search proves nothing.
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build as buildElectron } from "electron-vite";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const mainDir = join(import.meta.dirname, "..");

/** Strings that exist only because of the test capabilities or /call. */
const HOST_MARKERS = ["test.danger", "test.send", "test.note", "test.echo", "totum-test-outbox"];
const AGENT_MARKERS = ["Usage: /call"];

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

/**
 * The real electron-vite config, run through its own `build`. Only the output
 * folders are redirected, by a throwaway wrapper that calls the real config
 * and overrides `outDir` (so a regression in the real define or mode logic
 * shows up here). Main, host, preload and renderer are all built; host and
 * main are searched.
 */
async function buildHost(mode: Mode): Promise<string> {
  const outDir = join(work, `electron-${mode}`);
  const realConfig = pathToFileURL(join(mainDir, "electron.vite.config.ts")).href;
  const wrapper = join(work, `wrapper-${mode}.config.mjs`);
  writeFileSync(
    wrapper,
    [
      `import real from ${JSON.stringify(realConfig)};`,
      `const out = ${JSON.stringify(outDir)};`,
      `const at = (section, name) => ({ ...section, build: { ...section.build, outDir: out + "/" + name, emptyOutDir: true } });`,
      `export default async (env) => {`,
      `  const c = await (typeof real === "function" ? real(env) : real);`,
      `  return { ...c, main: at(c.main, "main"), preload: at(c.preload, "preload"), renderer: at(c.renderer, "renderer") };`,
      `};`,
    ].join("\n"),
  );
  await buildElectron({ configFile: wrapper, root: mainDir, mode, logLevel: "error" });
  return readTree(join(outDir, "main"));
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
