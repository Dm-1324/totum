// Runs inside Electron for agent-sandbox.test.ts (not a test file itself).
// Builds the agent exactly as main does (createAgentChild: real window
// options, page, preload and session filter, under the real Supervisor and
// AgentClient), probes it from inside, and prints one JSON line.
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { pathToFileURL } from "node:url";
import type { Log } from "@totum/shared";
import { app, BrowserWindow, session, type WebContents } from "electron";
import { AgentClient } from "./agent-client.js";
import { AGENT_PARTITION, agentWindowOptions, createAgentChild, type AgentChild } from "./agent-window.js";
import { Supervisor } from "./supervisor.js";

function arg(name: string): string {
  const prefix = `--${name}=`;
  const value = process.argv.find((a) => a.startsWith(prefix))?.slice(prefix.length);
  if (!value) throw new Error(`missing ${prefix}`);
  return value;
}

const pagePath = arg("page");
const preloadPath = arg("preload");
const outsideFile = arg("outside-file");

/**
 * Evaluated inside a page. Same code for the agent and the contrast window.
 * Workers: "ran" means the worker's script executed (it posted a message, or
 * threw while running); "blocked" means it never started.
 */
const PROBE = `async (urls, workers) => {
  const kinds = {};
  for (const name of ["require", "process", "Buffer", "module", "global", "exports", "__dirname"]) {
    kinds[name] = typeof globalThis[name];
  }
  const fetches = {};
  for (const url of urls) {
    try {
      const response = await fetch(url);
      fetches[url] = "ok " + response.status + " " + (await response.text()).slice(0, 20);
    } catch (error) {
      fetches[url] = "failed: " + error.name;
    }
  }
  const tryWorker = (make) => new Promise((resolve) => {
    let worker;
    try { worker = make(); } catch (error) { resolve("blocked: threw " + error.name); return; }
    const timer = setTimeout(() => { worker.terminate(); resolve("blocked: no event"); }, 2000);
    worker.onmessage = () => { clearTimeout(timer); worker.terminate(); resolve("ran: posted a message"); };
    worker.onerror = (event) => {
      clearTimeout(timer);
      event.preventDefault();
      resolve(event.message ? "ran: " + event.message : "blocked: error event");
    };
  });
  const workerResults = {};
  if (workers) {
    // agent.js is allowed by script-src 'self'; only worker-src stops it running as a worker.
    workerResults["same-folder file"] = await tryWorker(() => new Worker("./agent.js"));
    workerResults["blob"] = await tryWorker(() => new Worker(URL.createObjectURL(new Blob(["postMessage(1)"], { type: "text/javascript" }))));
    workerResults["data"] = await tryWorker(() => new Worker("data:text/javascript,postMessage(1)"));
  }
  return { kinds, fetches, workers: workerResults, globals: Object.getOwnPropertyNames(window).sort() };
}`;

interface ProbeResult {
  kinds: Record<string, string>;
  fetches: Record<string, string>;
  workers: Record<string, string>;
  globals: string[];
}

function probe(contents: WebContents, urls: string[], workers = false): Promise<ProbeResult> {
  return contents.executeJavaScript(`(${PROBE})(${JSON.stringify(urls)}, ${workers})`) as Promise<ProbeResult>;
}

function isAlive(pid: number | undefined): boolean {
  if (pid === undefined) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, what: string, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const logs: string[] = [];
const log: Log = (level, message, data) => logs.push(`${level} ${message}${data ? ` ${JSON.stringify(data)}` : ""}`);

async function run() {
  // A local server, so "fetch works" can be shown without the internet.
  const server = createServer((_req, res) => {
    res.writeHead(200, { "access-control-allow-origin": "*" });
    res.end("reachable");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const localUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
  const urls = [localUrl, "https://example.com/", pathToFileURL(outsideFile).href, "data:text/plain,hi"];

  // 1. The real agent.
  let current: AgentChild | undefined;
  const client: AgentClient = new AgentClient({ post: (m) => agent.post(m), log, timeoutMs: 5_000 });
  const agent = new Supervisor({
    name: "agent",
    spawn: () => (current = createAgentChild({ pagePath, preloadPath, log })),
    log,
    onMessage: (m) => client.receive(m),
    onUp: () => client.markUp(),
    onDown: (reason) => client.markDown(reason),
    restartDelayMs: () => 50,
  });
  agent.start();
  await until(() => agent.state === "running", "agent to start");
  const first = current!;
  const agentProbe = await probe(first.webContents, urls, true);
  const roundTrip = await client.send("hello");

  // 2. Baseline: the same options without the preload, on the same page.
  // Any global the agent has beyond these came from the bridge.
  const { webPreferences, ...rest } = agentWindowOptions(preloadPath);
  const { preload: _preload, ...prefsWithoutPreload } = webPreferences ?? {};
  const baseline = new BrowserWindow({ ...rest, webPreferences: prefsWithoutPreload });
  await baseline.loadFile(pagePath);
  const baselineProbe = await probe(baseline.webContents, []);
  baseline.destroy();

  // 3. Contrast: a window with Node integration. The same probe must see Node.
  const leaky = new BrowserWindow({
    show: false,
    webPreferences: { nodeIntegration: true, contextIsolation: false, sandbox: false },
  });
  await leaky.loadURL("about:blank");
  const leakyProbe = await probe(leaky.webContents, [localUrl]);
  leaky.destroy();

  // 4. The session filter on its own (no page CSP involved).
  const settle = (p: Promise<Response>) => p.then((r) => `ok ${r.status}`, (e: unknown) => `failed: ${String(e)}`);
  const agentSessionFetch = await settle(session.fromPartition(AGENT_PARTITION).fetch(localUrl));
  const defaultSessionFetch = await settle(session.defaultSession.fetch(localUrl));

  // 5. Supervisor behaviour: a crash is noticed and the agent restarts.
  const firstPid = first.pid;
  first.webContents.forcefullyCrashRenderer();
  await until(() => current !== first && agent.state === "running", "agent to restart");
  await until(() => !isAlive(firstPid), "crashed renderer to exit");
  const afterCrashReply = await client.send("again");

  // 6. Clean stop: the window and its renderer process are gone.
  const secondPid = current!.pid;
  await agent.stop();
  await until(() => !isAlive(secondPid), "stopped renderer to exit", 5_000).catch(() => {});

  server.close();
  return {
    agentProbe,
    baselineProbe,
    leakyProbe,
    roundTrip,
    agentSessionFetch,
    defaultSessionFetch,
    urls: { localUrl },
    crash: { firstPid, firstPidAlive: isAlive(firstPid), afterCrashReply },
    stop: { state: agent.state, secondPid, secondPidAlive: isAlive(secondPid), windows: BrowserWindow.getAllWindows().length },
    logs,
  };
}

// Windows come and go during the run; don't quit when none are open.
app.on("window-all-closed", () => {});
app
  .whenReady()
  .then(run)
  .then((result) => {
    console.log(`HARNESS_RESULT ${JSON.stringify(result)}`);
    app.exit(0);
  })
  .catch((error: unknown) => {
    console.log(`HARNESS_ERROR ${error instanceof Error ? error.stack : String(error)}`);
    app.exit(1);
  });
