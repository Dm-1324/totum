// @totum/main: Electron main process: windows, hotkey, push-to-talk, IPC routing, utility processes.
import { join } from "node:path";
import { app, BrowserWindow } from "electron";

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

void app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
  app.quit();
});
