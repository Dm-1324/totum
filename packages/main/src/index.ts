// @totum/main: Electron main process: windows, hotkey, push-to-talk, IPC routing, utility processes.
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import {
  AUDIT_LIST,
  AUDIT_UNDO,
  CHAT_SEND,
  GRANTS_LIST,
  GRANTS_REVOKE,
  hostDbArg,
  type Log,
  PERMISSION_ANSWER,
  PERMISSION_ASK,
  PERMISSION_CLOSED,
} from "@totum/shared";
import { app, BrowserWindow, ipcMain, session, type IpcMainInvokeEvent } from "electron";
import { AgentClient } from "./agent-client.js";
import { createAgentChild } from "./agent-window.js";
import { handleChatSend } from "./chat.js";
import { HostClient } from "./host-client.js";
import { PermissionBroker } from "./permissions.js";
import {
  handleAuditList,
  handleAuditUndo,
  handleGrantsList,
  handleGrantsRevoke,
  handlePermissionAnswer,
  relayCapabilityRequest,
  type UiDeps,
} from "./router.js";
import type { SenderInfo, TrustedRenderer } from "./sender.js";
import { Supervisor } from "./supervisor.js";
import { forkUtility } from "./utility.js";

const log: Log = (level, message, data) => console[level](message, data ?? "");

const agentClient = new AgentClient({
  post: (message) => agent.post(message),
  log,
  onCapabilityRequest: (message) => relayCapabilityRequest(message, { agent: agentClient, host: hostClient, log }),
});

/** Our window and page; the only renderer main will answer or show questions in. */
let trusted: TrustedRenderer | undefined;
let mainWindow: BrowserWindow | undefined;

const broker = new PermissionBroker({
  answer: (id, decision) => {
    if (!hostClient.answer(id, decision)) log("warn", "main: host gone before the user's answer arrived", { id });
  },
  show: (payload) => {
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isLoading()) return false;
    mainWindow.webContents.send(PERMISSION_ASK, payload);
    return true;
  },
  closed: (id) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(PERMISSION_CLOSED, { id });
  },
  hold: () => agentClient.hold(),
  log,
});

const hostClient = new HostClient({
  post: (message) => host.post(message),
  log,
  onAsk: (id, ask) => broker.open(id, ask),
  onDown: () => broker.dropAll(),
});

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
  // Host has no `app`, so main tells it where its database lives.
  spawn: () =>
    forkUtility(join(import.meta.dirname, "host.js"), "Totum host", [
      hostDbArg(join(app.getPath("userData"), "totum.db")),
    ]),
  log,
  onMessage: (message) => hostClient.receive(message),
  onUp: () => hostClient.markUp(),
  onDown: (reason) => hostClient.markDown(reason),
});

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
  mainWindow = win;
  // A reload drops the page's dialogs; show the open questions again.
  win.webContents.on("did-finish-load", () => broker.reshow());

  // The window only ever shows our page: no navigation, no pop-ups.
  win.webContents.on("will-navigate", (event) => event.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  // The hidden agent window doesn't count: closing this window quits the app.
  win.on("closed", () => {
    mainWindow = undefined;
    trusted = undefined;
    app.quit();
  });

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

const uiDeps: UiDeps = { trusted: () => trusted, broker, host: hostClient, log };
ipcMain.handle(PERMISSION_ANSWER, (event, raw: unknown) => handlePermissionAnswer(senderInfo(event), raw, uiDeps));
ipcMain.handle(AUDIT_LIST, (event, raw: unknown) => handleAuditList(senderInfo(event), raw, uiDeps));
ipcMain.handle(AUDIT_UNDO, (event, raw: unknown) => handleAuditUndo(senderInfo(event), raw, uiDeps));
ipcMain.handle(GRANTS_LIST, (event, raw: unknown) => handleGrantsList(senderInfo(event), raw, uiDeps));
ipcMain.handle(GRANTS_REVOKE, (event, raw: unknown) => handleGrantsRevoke(senderInfo(event), raw, uiDeps));

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
