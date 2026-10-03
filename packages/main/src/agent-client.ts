import { AgentToMain, describeIssues, type ChatErrorCode, type Log, type MainToAgent } from "@totum/shared";

export type AgentErrorCode = Extract<ChatErrorCode, "agent_timeout" | "agent_unavailable">;

/** A request to the agent that failed; `message` is fit to show the user. */
export class AgentRequestError extends Error {
  constructor(
    readonly code: AgentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AgentRequestError";
  }
}

export interface AgentClientOptions {
  /** Posts to the agent process; false when it isn't running. */
  post: (message: MainToAgent) => boolean;
  log: Log;
  timeoutMs?: number;
  newId?: () => string;
}

interface Pending {
  resolve: (text: string) => void;
  reject: (error: AgentRequestError) => void;
  timer: ReturnType<typeof setTimeout>;
}

export const DEFAULT_TIMEOUT_MS = 10_000;

/** How many answered ids to remember, so a late or repeated reply is logged as such. */
const SETTLED_MEMORY = 256;

/**
 * Main's side of the agent conversation. Every request gets a fresh id and a
 * timeout; a reply is delivered only to the pending request with its id.
 * Every request settles: with the reply, a timeout, or the agent going down.
 */
export class AgentClient {
  readonly #pending = new Map<string, Pending>();
  readonly #settled = new Set<string>();
  readonly #post: AgentClientOptions["post"];
  readonly #log: Log;
  readonly #timeoutMs: number;
  readonly #newId: () => string;
  #downReason: string | undefined = "The agent is starting. Try again in a moment.";

  constructor(options: AgentClientOptions) {
    this.#post = options.post;
    this.#log = options.log;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  get pendingCount(): number {
    return this.#pending.size;
  }

  /** The agent process is running and can take requests. */
  markUp(): void {
    this.#downReason = undefined;
  }

  /** The agent process is gone: fail everything waiting, refuse new requests. */
  markDown(reason: string): void {
    this.#downReason = reason;
    for (const [id, pending] of [...this.#pending]) {
      this.#settle(id);
      pending.reject(new AgentRequestError("agent_unavailable", reason));
    }
  }

  send(text: string): Promise<string> {
    if (this.#downReason !== undefined) {
      return Promise.reject(new AgentRequestError("agent_unavailable", this.#downReason));
    }

    const id = this.#newId();
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#settle(id);
        this.#log("warn", "main: agent request timed out", { id, timeoutMs: this.#timeoutMs });
        const seconds = Math.round(this.#timeoutMs / 1000);
        reject(new AgentRequestError("agent_timeout", `The agent didn't answer within ${seconds} seconds.`));
      }, this.#timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });

      if (!this.#post({ type: "agent.message", id, text })) {
        this.#settle(id);
        reject(new AgentRequestError("agent_unavailable", "The agent isn't running. Try again in a moment."));
      }
    });
  }

  /** A message arrived from the agent process. */
  receive(raw: unknown): void {
    const parsed = AgentToMain.safeParse(raw);
    if (!parsed.success) {
      this.#log("warn", "main: dropped invalid message from agent", {
        issues: describeIssues(parsed.error),
      });
      return;
    }

    const reply = parsed.data;
    const pending = this.#pending.get(reply.id);
    if (!pending) {
      const why = this.#settled.has(reply.id) ? "already answered or timed out" : "unknown";
      this.#log("warn", `main: dropped agent reply with ${why} id`, { id: reply.id });
      return;
    }
    this.#settle(reply.id);
    pending.resolve(reply.text);
  }

  #settle(id: string): void {
    const pending = this.#pending.get(id);
    if (pending) clearTimeout(pending.timer);
    this.#pending.delete(id);
    this.#settled.add(id);
    if (this.#settled.size > SETTLED_MEMORY) {
      const oldest = this.#settled.values().next().value;
      if (oldest !== undefined) this.#settled.delete(oldest);
    }
  }
}
