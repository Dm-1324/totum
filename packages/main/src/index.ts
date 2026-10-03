// @totum/main: Electron main process: windows, hotkey, push-to-talk, IPC routing, utility processes.
import { join } from "node:path";
import { CHAT_SEND, type Log } from "@totum/shared";
import { app, BrowserWindow, ipcMain } from "electron";
import { AgentClient } from "./agent-client.js";
import { handleChatSend } from "./chat.js";
import { handleHostMessage } from "./host-messages.js";
import { Supervisor } from "./supervisor.js";
import { forkUtility } from "./utility.js";

const log: Log = (level, message, data) => console[level](message, data ?? "");

const agentClient = new AgentClient({ post: (message) => agent.post(message), log });

const agent = new Supervisor({
  name: "agent",
  spawn: () => forkUtility(join(import.meta.dirname, "agent.js"), "Totum agent"),
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

function createWindow(): void {
  const win = new BrowserWindow({
    width: 720,
    height: 480,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // electron-vite sets this in dev; in a build the renderer is a local file.
  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(join(import.meta.dirname, "../renderer/index.html"));
  }
}

ipcMain.handle(CHAT_SEND, (_event, raw: unknown) => handleChatSend(raw, agentClient, log));

void app.whenReady().then(() => {
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
