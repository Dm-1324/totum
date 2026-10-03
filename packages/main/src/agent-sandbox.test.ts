// The milestone 1 done-when, second half: "the agent has no way to touch the
// filesystem". Runs the real agent window in real Electron (ADR 0004):
// agent-sandbox.harness.ts builds it with createAgentChild, the same code and
// options main uses, and probes it from inside.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const mainDir = join(import.meta.dirname, "..");
const repoPackageJson = join(mainDir, "..", "..", "package.json");
const electronPath = createRequire(import.meta.url)("electron") as string;

interface Probe {
  kinds: Record<string, string>;
  fetches: Record<string, string>;
  workers: Record<string, string>;
  globals: string[];
}
interface HarnessResult {
  agentProbe: Probe;
  baselineProbe: Probe;
  leakyProbe: Probe;
  roundTrip: string;
  agentSessionFetch: string;
  defaultSessionFetch: string;
  urls: { localUrl: string };
  crash: { firstPid: number; firstPidAlive: boolean; afterCrashReply: string };
  stop: { state: string; secondPid: number; secondPidAlive: boolean; windows: number };
  logs: string[];
}

const NODE_GLOBALS = ["require", "process", "Buffer", "module"];
let result: HarnessResult;
let harnessDir: string;

beforeAll(async () => {
  // The real agent page and preload, from the real build configs.
  await build({ configFile: join(mainDir, "agent.vite.config.ts") });
  await build({ configFile: join(mainDir, "agent-preload.vite.config.ts") });

  // The harness, bundled for Electron's main process.
  harnessDir = mkdtempSync(join(tmpdir(), "totum-agent-sandbox-"));
  await build({
    configFile: false,
    logLevel: "warn",
    build: {
      ssr: join(import.meta.dirname, "agent-sandbox.harness.ts"),
      outDir: harnessDir,
      target: "esnext",
      rollupOptions: { external: ["electron"], output: { format: "es", entryFileNames: "harness.mjs" } },
    },
    ssr: { noExternal: true, external: ["electron"] },
  });

  const run = spawnSync(
    electronPath,
    [
      join(harnessDir, "harness.mjs"),
      `--page=${join(mainDir, "out", "agent", "index.html")}`,
      `--preload=${join(mainDir, "out", "agent-preload", "agent.cjs")}`,
      `--outside-file=${repoPackageJson}`,
    ],
    { encoding: "utf8", timeout: 90_000 },
  );
  const line = run.stdout.split(/\r?\n/).find((l) => l.startsWith("HARNESS_RESULT "));
  if (!line) {
    throw new Error(`harness failed (exit ${run.status}):\n${run.stdout}\n${run.stderr}`);
  }
  result = JSON.parse(line.slice("HARNESS_RESULT ".length)) as HarnessResult;
}, 120_000);

afterAll(() => {
  if (harnessDir) rmSync(harnessDir, { recursive: true, force: true });
});

describe("agent sandbox (real agent window)", () => {
  it.each(NODE_GLOBALS)("%s is undefined in the agent", (name) => {
    expect(result.agentProbe.kinds[name]).toBe("undefined");
  });

  it("has no other Node globals either", () => {
    expect(result.agentProbe.kinds).toMatchObject({ global: "undefined", exports: "undefined", __dirname: "undefined" });
  });

  it("fails every fetch: local server, internet, a file outside its bundle, data:", () => {
    const fetches = Object.entries(result.agentProbe.fetches);
    expect(fetches).toHaveLength(4);
    for (const [url, outcome] of fetches) {
      expect(outcome, url).toMatch(/^failed: /);
    }
  });

  it("cannot start a Worker: not from its own file, a blob or a data URL", () => {
    const workers = Object.entries(result.agentProbe.workers);
    expect(workers).toHaveLength(3);
    for (const [kind, outcome] of workers) {
      expect(outcome, kind).toMatch(/^blocked: /);
    }
    expect(result.logs.some((l) => l.includes(`Content Security Policy directive: "worker-src 'none'"`))).toBe(true);
  });

  it("the bridge adds no globals: only the message port crosses, and it works", () => {
    const added = result.agentProbe.globals.filter((g) => !result.baselineProbe.globals.includes(g));
    expect(added).toEqual([]);
    expect(result.baselineProbe.globals.length).toBeGreaterThan(100); // a real global list, not empty
    expect(result.roundTrip).toBe("agent: hello");
  });

  it("the agent session blocks requests even without the page CSP", () => {
    expect(result.agentSessionFetch).toMatch(/^failed: .*ERR_BLOCKED_BY_CLIENT/);
    expect(result.logs).toContainEqual('warn main: blocked agent request {"scheme":"http"}');
  });
});

describe("contrast: the probe can detect a leak", () => {
  it.each(NODE_GLOBALS)("%s is visible in a window with nodeIntegration", (name) => {
    expect(result.leakyProbe.kinds[name]).not.toBe("undefined");
  });

  it("the same fetch succeeds outside the agent sandbox", () => {
    expect(result.leakyProbe.fetches[result.urls.localUrl]).toBe("ok 200 reachable");
    expect(result.defaultSessionFetch).toBe("ok 200");
  });
});

describe("agent window under the supervisor", () => {
  it("a renderer crash is noticed, logged, and the agent restarts", () => {
    expect(result.logs.some((l) => l.startsWith("error main: agent renderer gone"))).toBe(true);
    expect(result.logs.some((l) => l.includes("main: agent exited unexpectedly"))).toBe(true);
    expect(result.crash.firstPidAlive).toBe(false);
    expect(result.crash.afterCrashReply).toBe("agent: again");
  });

  it("stop() destroys the window and its renderer process", () => {
    expect(result.stop).toMatchObject({ state: "stopped", secondPidAlive: false, windows: 0 });
  });
});
