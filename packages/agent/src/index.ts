// @totum/agent: Utility process: agent loop, model adapter, context, memory. Never touches the OS.
// Entry point when main forks this as an Electron utility process.
import type { Log } from "@totum/shared";
import { handleMessage } from "./handler.js";

/** The part of Electron's process.parentPort we use; avoids importing electron. */
interface ParentPort {
  on(event: "message", listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

const port = (process as unknown as { parentPort?: ParentPort }).parentPort;
if (!port) {
  throw new Error("agent must run as an Electron utility process");
}

const log: Log = (level, message, data) => console[level](message, data ?? "");

port.on("message", ({ data }) => {
  const reply = handleMessage(data, log);
  if (reply) port.postMessage(reply);
});
