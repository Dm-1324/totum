// @totum/host: Utility process: permission engine, capabilities, audit log. The only package with OS access.
// Entry point when main forks this as an Electron utility process.
import { HOST_DB_ARG, type Log } from "@totum/shared";
import { openDb } from "./db.js";
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

const dbPath = process.argv.find((arg) => arg.startsWith(HOST_DB_ARG))?.slice(HOST_DB_ARG.length);
if (!dbPath) {
  throw new Error(`host needs ${HOST_DB_ARG}<path> from main`);
}
// If this throws (unreadable file, newer schema) the host exits and main's supervisor reports it.
const db = openDb(dbPath);
log("info", "host: database open");

port.on("message", ({ data }) => handleMessage(data, log));
port.postMessage(readyMessage());
