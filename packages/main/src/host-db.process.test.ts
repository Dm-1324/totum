// Milestone 2 done-when, storage half: the built host, forked as a real
// Electron utility process, opens its database file with node:sqlite and
// writes an audit row. Catches an Electron build without node:sqlite, which
// no in-Node test can see. Builds into a temp folder (never packages/main/out)
// and needs a desktop session, like agent-sandbox.test.ts.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const mainDir = join(import.meta.dirname, "..");
const electronPath = createRequire(import.meta.url)("electron") as string;

interface HarnessResult {
  callResult: { ok: boolean; code?: string };
  reply: { kind: string; entries: Record<string, unknown>[] };
}

let work: string;
let result: HarnessResult;

async function bundle(entry: string, outDir: string, fileName: string) {
  await build({
    configFile: false,
    logLevel: "warn",
    // The dev flag value: the test capabilities must be present for this test.
    define: { __TOTUM_DEV__: "true" },
    build: {
      ssr: entry,
      outDir,
      target: "esnext",
      rollupOptions: { external: ["electron", /^node:/], output: { format: "es", entryFileNames: fileName } },
    },
    ssr: { noExternal: true, external: ["electron"] },
  });
}

beforeAll(async () => {
  work = mkdtempSync(join(tmpdir(), "totum-host-db-"));
  await bundle(join(mainDir, "..", "host", "src", "index.ts"), join(work, "host"), "host.mjs");
  await bundle(join(import.meta.dirname, "host-db.harness.ts"), join(work, "harness"), "harness.mjs");

  const run = spawnSync(
    electronPath,
    [join(work, "harness", "harness.mjs"), `--host=${join(work, "host", "host.mjs")}`, `--db=${join(work, "totum.db")}`],
    { encoding: "utf8", timeout: 90_000 },
  );
  const line = run.stdout.split(/\r?\n/).find((l) => l.startsWith("HARNESS_RESULT "));
  if (!line) throw new Error(`harness failed (exit ${run.status}):\n${run.stdout}\n${run.stderr}`);
  result = JSON.parse(line.slice("HARNESS_RESULT ".length)) as HarnessResult;
}, 120_000);

afterAll(() => {
  if (work) rmSync(work, { recursive: true, force: true });
});

describe("host as a real utility process", () => {
  it("opens its database file", () => {
    expect(existsSync(join(work, "totum.db"))).toBe(true);
  });

  it("refuses an ungranted call and answers it", () => {
    expect(result.callResult).toMatchObject({ ok: false, code: "not_granted" });
  });

  it("wrote one audit row for that call, readable over the port", () => {
    expect(result.reply.kind).toBe("audit.list");
    expect(result.reply.entries).toHaveLength(1);
    expect(result.reply.entries[0]).toMatchObject({
      capability: "test.echo",
      outcome: "not_granted",
      taskId: "host-db-test",
    });
  });
});
