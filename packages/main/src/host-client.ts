// Main's side of the host conversation: capability calls and UI queries go
// out with main's own ids and are matched to replies by id; permission asks
// come in and go to the PermissionBroker. Every call and query settles.
import {
  type CapabilityCall,
  type CapabilityResult,
  describeIssues,
  type HostQuery,
  type HostQueryReply,
  HostToMain,
  type Log,
  type MainToHost,
  type PermissionAsk,
  type PermissionDecision,
} from "@totum/shared";

export interface HostClientOptions {
  /** Posts to the host process; false when it isn't running. */
  post: (message: MainToHost) => boolean;
  log: Log;
  /** Host asks the user something. */
  onAsk: (id: string, ask: PermissionAsk) => void;
  /** Host went down; its open asks are void. */
  onDown?: () => void;
  newId?: () => string;
  /** A call may wait minutes on the user, so this only catches a stuck host. */
  callTimeoutMs?: number;
  queryTimeoutMs?: number;
}

export const CALL_TIMEOUT_MS = 10 * 60_000;
export const QUERY_TIMEOUT_MS = 5_000;

export type QueryOutcome = { ok: true; reply: HostQueryReply } | { ok: false; message: string };

interface Waiting<T> {
  settle: (value: T) => void;
  fail: (message: string) => T;
  timer: ReturnType<typeof setTimeout>;
  /** For queries: the reply must be of the same kind. */
  kind?: HostQuery["kind"];
}

const unavailable = (message: string): CapabilityResult => ({
  ok: false,
  code: "host_unavailable",
  message,
  hint: "Wait a moment and try again; tell the user if it keeps failing.",
});

export class HostClient {
  readonly #calls = new Map<string, Waiting<CapabilityResult>>();
  readonly #queries = new Map<string, Waiting<QueryOutcome>>();
  readonly #o: HostClientOptions;
  readonly #newId: () => string;
  #downReason: string | undefined = "Totum's host is starting. Try again in a moment.";

  constructor(options: HostClientOptions) {
    this.#o = options;
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  get pendingCount(): number {
    return this.#calls.size + this.#queries.size;
  }

  markUp(): void {
    this.#downReason = undefined;
  }

  /** Host is gone: settle everything waiting, refuse new work, void open asks. */
  markDown(reason: string): void {
    this.#downReason = reason;
    for (const [id, waiting] of [...this.#calls]) this.#finish(this.#calls, id, waiting.fail(reason));
    for (const [id, waiting] of [...this.#queries]) this.#finish(this.#queries, id, waiting.fail(reason));
    this.#o.onDown?.();
  }

  /** Runs a call in host. Never rejects. */
  call(call: CapabilityCall): Promise<CapabilityResult> {
    if (this.#downReason !== undefined) return Promise.resolve(unavailable(this.#downReason));
    const id = this.#newId();
    return this.#wait(this.#calls, id, this.#o.callTimeoutMs ?? CALL_TIMEOUT_MS, unavailable, undefined, () =>
      this.#o.post({ type: "capability.request", id, origin: "agent", call }),
    );
  }

  /** Asks host for the UI. Never rejects. */
  query(query: HostQuery): Promise<QueryOutcome> {
    const fail = (message: string): QueryOutcome => ({ ok: false, message });
    if (this.#downReason !== undefined) return Promise.resolve(fail(this.#downReason));
    const id = this.#newId();
    return this.#wait(this.#queries, id, this.#o.queryTimeoutMs ?? QUERY_TIMEOUT_MS, fail, query.kind, () =>
      this.#o.post({ type: "host.query", id, origin: "ui", query }),
    );
  }

  /** Passes the user's answer to host. False when host isn't running. */
  answer(id: string, decision: PermissionDecision): boolean {
    return this.#o.post({ type: "permission.answer", id, decision });
  }

  receive(raw: unknown): void {
    const { log } = this.#o;
    const parsed = HostToMain.safeParse(raw);
    if (!parsed.success) {
      log("warn", "main: dropped invalid message from host", { issues: describeIssues(parsed.error) });
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "host.ready":
        log("info", "main: host ready");
        return;
      case "permission.ask":
        this.#o.onAsk(message.id, message.ask);
        return;
      case "capability.result": {
        const waiting = this.#calls.get(message.id);
        if (!waiting) return log("warn", "main: dropped host result with unknown or settled id", { id: message.id });
        this.#finish(this.#calls, message.id, message.result);
        return;
      }
      case "host.reply": {
        const waiting = this.#queries.get(message.id);
        if (!waiting) return log("warn", "main: dropped host reply with unknown or settled id", { id: message.id });
        if (waiting.kind !== message.reply.kind) {
          log("warn", "main: host replied with the wrong kind", { expected: waiting.kind, got: message.reply.kind });
          this.#finish(this.#queries, message.id, waiting.fail("Totum's host gave an unexpected answer."));
          return;
        }
        this.#finish(this.#queries, message.id, { ok: true, reply: message.reply });
        return;
      }
    }
  }

  #wait<T>(
    map: Map<string, Waiting<T>>,
    id: string,
    timeoutMs: number,
    fail: (message: string) => T,
    kind: HostQuery["kind"] | undefined,
    post: () => boolean,
  ): Promise<T> {
    return new Promise<T>((settle) => {
      const timer = setTimeout(() => {
        this.#o.log("warn", "main: host request timed out", { id, timeoutMs });
        this.#finish(map, id, fail("Totum's host didn't answer in time."));
      }, timeoutMs);
      const waiting: Waiting<T> = { settle, fail, timer };
      if (kind !== undefined) waiting.kind = kind;
      map.set(id, waiting);
      if (!post()) this.#finish(map, id, fail("Totum's host isn't running. Try again in a moment."));
    });
  }

  #finish<T>(map: Map<string, Waiting<T>>, id: string, value: T): void {
    const waiting = map.get(id);
    if (!waiting) return;
    clearTimeout(waiting.timer);
    map.delete(id);
    waiting.settle(value);
  }
}
