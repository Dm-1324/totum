// Host's side of the main <-> host port: capability calls (through the
// engine), the user's answers to permission asks, and the UI's log and grant
// queries. Every message is validated; every request gets exactly one reply.
import {
  type CapabilityResult,
  describeIssues,
  ErrorCode,
  type HostQuery,
  type HostQueryReply,
  type HostToMain,
  type Log,
  MainToHost,
  MAX_TEXT_LENGTH,
  type PermissionAsk,
  type PermissionDecision,
  type Result,
} from "@totum/shared";
import type { AuditLog } from "./audit.js";
import type { PermissionEngine } from "./engine.js";
import type { GrantStore } from "./grants.js";

/** Sent once when the host process is up. */
export function readyMessage(): HostToMain {
  return { type: "host.ready" };
}

/** Main expires asks after 5 minutes; this backstop only matters if main never answers. */
export const ASK_BACKSTOP_MS = 6 * 60_000;
/** Most audit entries the UI gets at once. */
export const AUDIT_PAGE = 200;

export interface HostHandlerDeps {
  engine: PermissionEngine;
  grants: GrantStore;
  audit: AuditLog;
  post: (message: HostToMain) => void;
  log: Log;
  newId?: () => string;
  askBackstopMs?: number;
}

const clipText = (text: string) => (text.length > MAX_TEXT_LENGTH ? text.slice(0, MAX_TEXT_LENGTH - 1) + "…" : text);

/** A Result made safe for the wire schema: valid code, non-empty capped texts. */
export function toWire(result: Result<unknown>): CapabilityResult {
  if (result.ok) return { ok: true, output: result.output, untrusted: result.untrusted };
  const wire: CapabilityResult = {
    ok: false,
    code: ErrorCode.safeParse(result.code).success ? result.code : "invalid_code",
    message: clipText(result.message || "The capability failed without saying why."),
  };
  if (result.hint) wire.hint = clipText(result.hint);
  return wire;
}

export class HostHandler {
  readonly #deps: HostHandlerDeps;
  readonly #asks = new Map<string, { resolve: (d: PermissionDecision) => void; timer: ReturnType<typeof setTimeout> }>();
  readonly #newId: () => string;

  constructor(deps: HostHandlerDeps) {
    this.#deps = deps;
    this.#newId = deps.newId ?? (() => crypto.randomUUID());
  }

  get openAsks(): number {
    return this.#asks.size;
  }

  /** Handles one message from main. */
  handle(raw: unknown): void {
    const { log, post } = this.#deps;
    const parsed = MainToHost.safeParse(raw);
    if (!parsed.success) {
      log("warn", "host: rejected invalid message", { issues: describeIssues(parsed.error) });
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "capability.request":
        this.#deps.engine
          .call(message.call, this.#ask)
          .catch((error: unknown): Result<unknown> => {
            // The engine never throws by design; if it does, the caller still gets an answer.
            log("error", "host: engine threw", { error: String(error) });
            return { ok: false, code: "run_failed", message: "Totum's permission engine failed unexpectedly." };
          })
          .then((result) => post({ type: "capability.result", id: message.id, result: toWire(result) }));
        return;
      case "permission.answer": {
        const open = this.#asks.get(message.id);
        if (!open) {
          log("warn", "host: dropped answer to an unknown or finished ask", { id: message.id });
          return;
        }
        this.#settle(message.id, message.decision);
        return;
      }
      case "host.query":
        this.#query(message.query).then(
          (reply) => post({ type: "host.reply", id: message.id, reply }),
          // No reply: main times the query out and tells the UI.
          (error: unknown) => log("error", "host: query failed", { kind: message.query.kind, error: String(error) }),
        );
        return;
    }
  }

  /** The engine's way to ask the user: one permission.ask per question, answered by id. */
  readonly #ask = (ask: PermissionAsk): Promise<PermissionDecision> => {
    const id = this.#newId();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.#deps.log("warn", "host: no answer to a permission ask; treating it as a timeout", { id });
        this.#settle(id, { decision: "timeout" });
      }, this.#deps.askBackstopMs ?? ASK_BACKSTOP_MS);
      this.#asks.set(id, { resolve, timer });
      this.#deps.post({ type: "permission.ask", id, ask });
    });
  };

  #settle(id: string, decision: PermissionDecision): void {
    const open = this.#asks.get(id);
    if (!open) return;
    clearTimeout(open.timer);
    this.#asks.delete(id);
    open.resolve(decision);
  }

  async #query(query: HostQuery): Promise<HostQueryReply> {
    const { audit, engine, grants } = this.#deps;
    switch (query.kind) {
      case "audit.list":
        return { kind: "audit.list", entries: audit.list(AUDIT_PAGE) };
      case "audit.undo":
        return { kind: "audit.undo", result: toWire(await engine.undo(query.entryId)) };
      case "grants.list":
        return { kind: "grants.list", grants: grants.list() };
      case "grants.revoke":
        grants.revoke(query.capability, query.scope);
        return { kind: "grants.revoke" };
    }
  }
}
