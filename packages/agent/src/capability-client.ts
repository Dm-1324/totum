import {
  type AgentCall,
  AgentCapabilityRequest,
  type AgentCapabilityResult,
  type AgentToMain,
  type CapabilityResult,
  describeIssues,
  type Log,
} from "@totum/shared";

export interface CapabilityClientOptions {
  /** Posts to main over the agent's one port. */
  post: (message: AgentToMain) => void;
  log: Log;
  newId?: (() => string) | undefined;
}

/**
 * The agent's one way to ask for anything on the machine: a `capability.request`
 * to main, checked against the shared schema first. Main stamps the task id of
 * the user message in flight (or refuses with `no_task`) and relays to host;
 * host decides grants and approvals. The dev `/call` command and the
 * milestone-3 model loop both call `request`; there is no other path.
 */
export class CapabilityClient {
  readonly #pending = new Map<string, (result: CapabilityResult) => void>();
  readonly #o: CapabilityClientOptions;
  readonly #newId: () => string;

  constructor(options: CapabilityClientOptions) {
    this.#o = options;
    this.#newId = options.newId ?? (() => crypto.randomUUID());
  }

  /** Resolves with host's result, or a local failure if the call never left the agent. Never rejects. */
  request(call: AgentCall): Promise<CapabilityResult> {
    const parsed = AgentCapabilityRequest.safeParse({ type: "capability.request", id: this.#newId(), call });
    if (!parsed.success) {
      const issues = describeIssues(parsed.error);
      this.#o.log("warn", "agent: refused a malformed capability request", { issues });
      // Tell main so the audit log shows the refusal; whatever the caller wrote is cut short.
      const capability = (call as { capability?: unknown }).capability;
      this.#o.post({
        type: "capability.refused",
        capability: (typeof capability === "string" ? capability : "").slice(0, 80),
        issues: issues.slice(0, 10).map((issue) => issue.slice(0, 200)),
      });
      return Promise.resolve({
        ok: false,
        code: "invalid_request",
        message: `That capability call is malformed (${issues.join("; ")}).`.slice(0, 500),
      });
    }
    const message = parsed.data;
    // Unknown ids go to host too: it answers, and audits the refusal.
    return new Promise((resolve) => {
      this.#pending.set(message.id, resolve);
      this.#o.post(message);
    });
  }

  /** Host's answer, relayed by main. */
  receive(message: AgentCapabilityResult): void {
    const resolve = this.#pending.get(message.id);
    if (!resolve) {
      this.#o.log("warn", "agent: dropped a capability result with an unknown id", { id: message.id });
      return;
    }
    this.#pending.delete(message.id);
    resolve(message.result);
  }

  get pendingCount(): number {
    return this.#pending.size;
  }
}
