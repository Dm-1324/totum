// Test fixture: an engine over an in-memory database with the test
// capabilities, and a scripted user who answers permission asks.
import type { CapabilityCall, Log, PermissionAsk, PermissionDecision } from "@totum/shared";
import { AuditLog } from "./audit.js";
import { createTestCapabilities } from "./capabilities/test-capabilities.js";
import { type Db, openDb } from "./db.js";
import { type AnyCapability, type Ask, PermissionEngine } from "./engine.js";
import { GrantStore, type PathProbe } from "./grants.js";

/** No folder exists; enough for capabilities with app and account scopes. */
export const emptyFs: PathProbe = {
  realpath: () => {
    throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
  },
  exists: () => false,
};

export interface ScriptedUser {
  ask: Ask;
  asks: PermissionAsk[];
  /** Answers still waiting, oldest first; resolve one to let its call continue. */
  pending: Array<{ ask: PermissionAsk; answer: (decision: PermissionDecision) => void }>;
}

/**
 * A user who answers from `script` in order (a function gets the ask), or,
 * with `script` undefined, leaves every ask pending until the test answers it.
 */
export function scriptedUser(
  script?: Array<PermissionDecision | ((ask: PermissionAsk) => PermissionDecision)>,
): ScriptedUser {
  const user: ScriptedUser = {
    asks: [],
    pending: [],
    ask: (ask) => {
      user.asks.push(ask);
      if (script === undefined) {
        return new Promise((resolve) => user.pending.push({ ask, answer: resolve }));
      }
      const next = script.shift();
      if (next === undefined) throw new Error(`unscripted ask: ${ask.kind} ${ask.capability}`);
      return Promise.resolve(typeof next === "function" ? next(ask) : next);
    },
  };
  return user;
}

export const allowSession: PermissionDecision = { decision: "allow", lifetime: "session" };
export const allowAlways: PermissionDecision = { decision: "allow", lifetime: "always" };
export const approve: PermissionDecision = { decision: "approve" };
export const deny: PermissionDecision = { decision: "deny" };
export const timeout: PermissionDecision = { decision: "timeout" };

export interface Fixture {
  db: Db;
  engine: PermissionEngine;
  grants: GrantStore;
  audit: AuditLog;
  logs: Array<{ level: string; message: string }>;
}

export function makeEngine(options: { capabilities?: (db: Db) => AnyCapability[]; fs?: PathProbe } = {}): Fixture {
  const db = openDb(":memory:");
  const grants = new GrantStore(db);
  const audit = new AuditLog(db);
  const logs: Fixture["logs"] = [];
  const log: Log = (level, message) => logs.push({ level, message });
  const engine = new PermissionEngine({
    capabilities: (options.capabilities ?? createTestCapabilities)(db),
    grants,
    audit,
    log,
    fs: options.fs ?? emptyFs,
  });
  return { db, engine, grants, audit, logs };
}

let task = 0;
/** A call in a fresh task unless `taskId` is given. */
export function call(capability: string, input: unknown, extra: Partial<CapabilityCall> = {}): CapabilityCall {
  return { taskId: `task-${++task}`, capability, input, shapedByUntrusted: false, ...extra };
}

/** Lets pending promise callbacks run. */
export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
