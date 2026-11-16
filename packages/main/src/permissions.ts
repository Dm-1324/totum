// The PermissionBroker: main's part in asking the user. It shows host's
// questions in the trusted window, passes answers back, and answers
// `timeout` itself when there's no window or nobody answers in time. It never
// decides anything: host's engine does. See docs/plans/m2.md slice 4.
import type { Log, PermissionAsk, PermissionDecision, UiErrorCode, UiPermissionAsk } from "@totum/shared";

export const ASK_EXPIRY_MS = 5 * 60_000;
/** An approving answer sooner than this after the question appeared is ignored (double-click guard). */
export const MIN_SHOWN_MS = 500;

export interface BrokerOptions {
  /** Passes a decision to host. */
  answer: (id: string, decision: PermissionDecision) => void;
  /** Shows a question in the trusted window. False when there is no window to show it in. */
  show: (payload: UiPermissionAsk) => boolean;
  /** Tells the window a question is over without its answer. */
  closed: (id: string) => void;
  /** Pauses the agent's chat timeout while the user decides; returns the release. */
  hold: () => () => void;
  log: Log;
  expiryMs?: number;
  /** Overrides MIN_SHOWN_MS (tests). */
  minShownMs?: number;
  /** Clock in ms (tests). */
  now?: () => number;
}

interface OpenAsk {
  openedAt: number;
  ask: PermissionAsk;
  timer: ReturnType<typeof setTimeout>;
  release: () => void;
}

/** Is this decision one of the answers this question allows? `timeout` is main's alone. */
export function decisionFits(ask: PermissionAsk, decision: PermissionDecision): boolean {
  switch (decision.decision) {
    case "deny":
      return true;
    case "allow":
      return ask.kind === "grant" && ask.lifetimes.includes(decision.lifetime);
    case "approve":
      return ask.kind === "approval";
    case "timeout":
      return false;
  }
}

export class PermissionBroker {
  readonly #open = new Map<string, OpenAsk>();
  readonly #o: BrokerOptions;
  // The window shows one question at a time, so the next one appears when the last was answered.
  #lastAnswerAt = Number.NEGATIVE_INFINITY;

  constructor(options: BrokerOptions) {
    this.#o = options;
  }

  get openCount(): number {
    return this.#open.size;
  }

  /** Host asked something. */
  open(id: string, ask: PermissionAsk): void {
    if (this.#open.has(id)) {
      this.#o.log("warn", "main: host reused an open ask id; ignoring the duplicate", { id });
      return;
    }
    if (!this.#o.show({ id, ask })) {
      this.#o.log("warn", "main: no window to ask the user in; answering timeout", { id });
      this.#o.answer(id, { decision: "timeout" });
      return;
    }
    const timer = setTimeout(() => {
      this.#o.log("warn", "main: permission ask expired", { id });
      this.#close(id);
      this.#o.closed(id);
      this.#o.answer(id, { decision: "timeout" });
    }, this.#o.expiryMs ?? ASK_EXPIRY_MS);
    this.#open.set(id, { openedAt: this.#now(), ask, timer, release: this.#o.hold() });
  }

  /**
   * The user answered in the trusted window (the caller checked the sender).
   * Returns an error code, or undefined when the answer went to host.
   */
  answer(id: string, decision: PermissionDecision): Extract<UiErrorCode, "unknown_ask" | "invalid_request" | "too_soon"> | undefined {
    const open = this.#open.get(id);
    if (!open) return "unknown_ask";
    if (!decisionFits(open.ask, decision)) {
      this.#o.log("warn", "main: refused an answer this question doesn't allow", { id, decision: decision.decision });
      return "invalid_request";
    }
    // Only answers that let something happen wait; refusing is always immediate.
    if (decision.decision !== "deny") {
      const shownAt = Math.max(open.openedAt, this.#lastAnswerAt);
      if (this.#now() - shownAt < (this.#o.minShownMs ?? MIN_SHOWN_MS)) {
        this.#o.log("warn", "main: ignored an approval that came too soon after the question appeared", { id });
        return "too_soon";
      }
    }
    this.#lastAnswerAt = this.#now();
    this.#close(id);
    this.#o.answer(id, decision);
    return undefined;
  }

  #now(): number {
    return (this.#o.now ?? Date.now)();
  }

  /** The window reloaded: show every open question again. */
  reshow(): void {
    for (const [id, open] of this.#open) {
      open.openedAt = this.#now();
      this.#o.show({ id, ask: open.ask });
    }
  }

  /** Host went down: its questions are void. Close them in the window; nobody to answer. */
  dropAll(): void {
    for (const id of [...this.#open.keys()]) {
      this.#close(id);
      this.#o.closed(id);
    }
  }

  #close(id: string): void {
    const open = this.#open.get(id);
    if (!open) return;
    clearTimeout(open.timer);
    open.release();
    this.#open.delete(id);
  }
}
