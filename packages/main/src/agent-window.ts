// The agent runs in a hidden, sandboxed renderer (ADR 0004). This module owns
// how that window is created and locked down, and adapts it to the
// supervisor's Child so restarts, timeouts and clean quit work as before.
import { dirname } from "node:path";
import { AGENT_PORT_CHANNEL, type Log } from "@totum/shared";
import {
  BrowserWindow,
  MessageChannelMain,
  session,
  type BrowserWindowConstructorOptions,
  type MessagePortMain,
  type Session,
  type WebContents,
} from "electron";
import { isAllowedAgentRequest } from "./agent-request.js";
import type { Child } from "./supervisor.js";

/** In-memory session used only by the agent window (no "persist:" prefix). */
export const AGENT_PARTITION = "totum-agent";

/**
 * The agent window's options. main and the sandbox test both build the window
 * from this function, so the test checks exactly what ships.
 */
export function agentWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    show: false,
    webPreferences: {
      preload: preloadPath,
      partition: AGENT_PARTITION,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      backgroundThrottling: false,
      spellcheck: false,
      devTools: false,
      enableWebSQL: false,
      navigateOnDragDrop: false,
    },
  };
}

const hardened = new WeakSet<Session>();

/**
 * Second layer behind the page CSP: the agent session cancels every request
 * except the agent's own files, and refuses every permission.
 */
export function hardenAgentSession(ses: Session, agentDir: string, log: Log): void {
  if (hardened.has(ses)) return;
  hardened.add(ses);
  ses.webRequest.onBeforeRequest((details, callback) => {
    const allowed = isAllowedAgentRequest(details.url, agentDir);
    if (!allowed) log("warn", "main: blocked agent request", { scheme: schemeOf(details.url) });
    callback({ cancel: !allowed });
  });
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
}

function schemeOf(url: string): string {
  const colon = url.indexOf(":");
  return colon > 0 ? url.slice(0, colon) : "(none)";
}

export interface AgentChildOptions {
  /** out/agent/index.html */
  pagePath: string;
  /** out/agent-preload/agent.cjs */
  preloadPath: string;
  log: Log;
}

/** The supervisor's view of the agent window, plus its webContents for tests. */
export interface AgentChild extends Child {
  readonly webContents: WebContents;
}

const CONSOLE_LEVEL = { warning: "warn", error: "error" } as const;

/**
 * Creates the agent window. "Spawned" means the page loaded and holds its
 * port; a crash, failed load or destroyed window counts as exit; kill()
 * destroys the window, which ends its renderer process.
 */
export function createAgentChild({ pagePath, preloadPath, log }: AgentChildOptions): AgentChild {
  hardenAgentSession(session.fromPartition(AGENT_PARTITION), dirname(pagePath), log);

  const win = new BrowserWindow(agentWindowOptions(preloadPath));
  const contents = win.webContents;
  const spawnListeners: Array<() => void> = [];
  const messageListeners: Array<(message: unknown) => void> = [];
  const exitListeners: Array<(code: number) => void> = [];
  let port: MessagePortMain | undefined;
  let exited = false;

  const exit = (code: number) => {
    if (exited) return;
    exited = true;
    port?.close();
    if (!win.isDestroyed()) win.destroy();
    for (const listener of exitListeners) listener(code);
  };

  // The window only ever shows the agent page.
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.setWindowOpenHandler(() => ({ action: "deny" }));

  contents.on("console-message", (details) => {
    const level = details.level === "warning" || details.level === "error" ? CONSOLE_LEVEL[details.level] : "info";
    log(level, `agent: ${details.message}`);
  });
  contents.on("preload-error", (_event, _path, error) => {
    log("error", "main: agent preload failed", { error: String(error) });
    exit(-1);
  });
  contents.on("did-fail-load", (_event, errorCode, errorDescription, _url, isMainFrame) => {
    if (!isMainFrame) return;
    log("error", "main: agent page failed to load", { errorCode, errorDescription });
    exit(-2);
  });
  contents.on("render-process-gone", (_event, details) => {
    log("error", "main: agent renderer gone", { reason: details.reason, exitCode: details.exitCode });
    exit(details.exitCode === 0 ? -3 : details.exitCode);
  });
  win.on("closed", () => exit(0));

  contents.once("did-finish-load", () => {
    if (exited) return;
    const { port1, port2 } = new MessageChannelMain();
    port = port1;
    port1.on("message", (event) => {
      for (const listener of messageListeners) listener(event.data);
    });
    port1.start();
    contents.postMessage(AGENT_PORT_CHANNEL, null, [port2]);
    for (const listener of spawnListeners) listener();
  });

  win.loadFile(pagePath).catch(() => {
    // Reported through did-fail-load.
  });

  return {
    webContents: contents,
    get pid() {
      if (exited || contents.isDestroyed()) return undefined;
      const pid = contents.getOSProcessId();
      return pid > 0 ? pid : undefined;
    },
    postMessage: (message) => {
      if (!port) throw new Error("agent port not ready");
      port.postMessage(message);
    },
    kill: () => exit(0),
    onSpawn: (listener) => spawnListeners.push(listener),
    onMessage: (listener) => messageListeners.push(listener),
    onExit: (listener) => exitListeners.push(listener),
  };
}
