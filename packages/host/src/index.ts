// @totum/host: Utility process: permission engine, capabilities, audit log. The only package with OS access.
// Entry point when main forks this as an Electron utility process.
import type { Log } from "@totum/shared";
import { handleMessage, readyMessage } from "./handler.js";

/** The part of Electron's process.parentPort we use. */
interface ParentPort {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!port) {
  throw new Error("host must run as an Electron utility process");
}

const log: Log = (level, message, data) => console[level](message, data ?? "");

port.on("message", ({ data }) => handleMessage(data, log));
port.postMessage(readyMessage());
