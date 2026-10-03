// @totum/host: Utility process: permission engine, capabilities, audit log. The only package with OS access.
// Entry point when main forks this as an Electron utility process.
import { HOST_DB_ARG, type Log } from "@totum/shared";
import { AuditLog } from "./audit.js";
import { createTestCapabilities } from "./capabilities/test-capabilities.js";
import { openDb } from "./db.js";
import { PermissionEngine } from "./engine.js";
import { GrantStore } from "./grants.js";
import { HostHandler, readyMessage } from "./handler.js";
import { nodeFsProbe } from "./node-fs-probe.js";
import { productionCapabilities } from "./registry.js";

/** Set by the build: true in dev and test builds, false in production (electron.vite.config.ts). */
declare const __TOTUM_DEV__: boolean;

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

// Test capabilities exist only in dev and test builds. Vite replaces the flag
// with a constant, so a production bundle drops the branch and the module.
const capabilities = [...productionCapabilities(db), ...(__TOTUM_DEV__ ? createTestCapabilities(db) : [])];
const grants = new GrantStore(db);
const audit = new AuditLog(db);
const engine = new PermissionEngine({ capabilities, grants, audit, log, fs: nodeFsProbe });
log("info", "host: capabilities ready", { ids: engine.ids() });

const handler = new HostHandler({ engine, grants, audit, log, post: (message) => port.postMessage(message) });
port.on("message", ({ data }) => handler.handle(data));
port.postMessage(readyMessage());
