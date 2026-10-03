// @totum/main: Electron main process: windows, hotkey, push-to-talk, IPC routing, utility processes.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { CHAT_SEND, type Log } from "@totum/shared";
import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { AgentClient } from "./agent-client.js";
import { createAgentChild } from "./agent-window.js";
import { handleChatSend } from "./chat.js";
import { handleHostMessage } from "./host-messages.js";
import type { SenderInfo, TrustedRenderer } from "./sender.js";
import { Supervisor } from "./supervisor.js";
import { forkUtility } from "./utility.js";

const log: Log = (level, message, data) => console[level](message, data ?? "");

const agentClient = new AgentClient({ post: (message) => agent.post(message), log });

const agent = new Supervisor({
  name: "agent",
  // A hidden sandboxed renderer, not a utility process (ADR 0004).
  spawn: () =>
    createAgentChild({
      pagePath: join(import.meta.dirname, "../agent/index.html"),
      preloadPath: join(import.meta.dirname, "../agent-preload/agent.cjs"),
      log,
    }),
  log,
  onMessage: (message) => agentClient.receive(message),
  onUp: () => agentClient.markUp(),
  onDown: (reason) => agentClient.markDown(reason),
});

const host = new Supervisor({
  name: "host",
  spawn: () => forkUtility(join(import.meta.dirname, "host.js"), "Totum host"),
  log,
  onMessage: (message) => handleHostMessage(message, log),
});

/** Our window and page; the only renderer main will answer. */
let trusted: TrustedRenderer | undefined;

function createWindow(): void {
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // electron-vite sets this in dev; in a build the renderer is a local file.
  const url =
    process.env["ELECTRON_RENDERER_URL"] ?? pathToFileURL(join(import.meta.dirname, "../renderer/index.html")).href;
  trusted = { webContentsId: win.webContents.id, url };

  // The window only ever shows our page: no navigation, no pop-ups.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // The hidden agent window doesn't count: closing this window quits the app.
  win.on("closed", () => app.quit());

  void win.loadURL(url);
}

function senderInfo(event: IpcMainInvokeEvent): SenderInfo {
  const frame = event.senderFrame;
  return {
    webContentsId: event.sender.id,
    isMainFrame: frame !== null && frame.parent === null,
    url: frame?.url,
  };
}

ipcMain.handle(CHAT_SEND, (event, raw: unknown) =>
  handleChatSend(senderInfo(event), raw, { agent: agentClient, log, trusted: () => trusted }),
);

void app.whenReady().then(() => {
  // The UI window gets no permissions (camera, mic, notifications, ...).
  // Grant one only when a milestone needs it, and only to the trusted window.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  agent.start();
  host.start();
  createWindow();
});

app.on("window-all-closed", () => {
  app.quit();
});

// Stop both utility processes and wait for them to exit before quitting,
// so nothing outlives the app.
let stopped = false;
app.on("will-quit", (event) => {
  if (stopped) return;
  event.preventDefault();
  void Promise.all([agent.stop(), host.stop()]).finally(() => {
    stopped = true;
    app.quit();
  });
});
