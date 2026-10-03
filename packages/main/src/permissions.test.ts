import type { PermissionAsk, PermissionDecision, UiPermissionAsk } from "@totum/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_EXPIRY_MS, decisionFits, PermissionBroker } from "./permissions.js";

const grantAsk: PermissionAsk = {
  kind: "grant",
  taskId: "t1",
  capability: "test.echo",
  tier: 0,
  scope: { kind: "app", app: "totum-test" },
  summary: "Echo.",
  lifetimes: ["session", "always"],
  shapedByUntrusted: false,
};
const sessionOnly: PermissionAsk = { ...grantAsk, capability: "test.danger", tier: 2, lifetimes: ["session"] };
const approvalAsk: PermissionAsk = {
  kind: "approval",
  taskId: "t1",
  capability: "test.danger",
  tier: 2,
  scope: { kind: "app", app: "totum-test-notes" },
  action: "Delete all 2 notes",
  shapedByUntrusted: false,
};

function setup(options: { window?: boolean } = {}) {
  const answers: Array<[string, PermissionDecision]> = [];
  const shown: UiPermissionAsk[] = [];
  const closed: string[] = [];
  let holds = 0;
  const broker = new PermissionBroker({
    answer: (id, d) => answers.push([id, d]),
    show: (p) => {
      if (options.window === false) return false;
      shown.push(p);
      return true;
    },
    closed: (id) => closed.push(id),
    hold: () => {
      holds++;
      return () => holds--;
    },
    log: vi.fn(),
  });
  return { broker, answers, shown, closed, holds: () => holds };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("decisionFits", () => {
  it("allows only the answers a question offers", () => {
    expect(decisionFits(grantAsk, { decision: "allow", lifetime: "always" })).toBe(true);
    expect(decisionFits(sessionOnly, { decision: "allow", lifetime: "always" })).toBe(false);
    expect(decisionFits(sessionOnly, { decision: "allow", lifetime: "session" })).toBe(true);
    expect(decisionFits(grantAsk, { decision: "approve" })).toBe(false);
    expect(decisionFits(approvalAsk, { decision: "approve" })).toBe(true);
    expect(decisionFits(approvalAsk, { decision: "allow", lifetime: "session" })).toBe(false);
    expect(decisionFits(approvalAsk, { decision: "deny" })).toBe(true);
  });

  it("never lets the UI answer timeout", () => {
    expect(decisionFits(grantAsk, { decision: "timeout" })).toBe(false);
  });
});

describe("PermissionBroker", () => {
  it("shows a question, holds the agent timeout, and passes the answer to host once", () => {
    const { broker, answers, shown, holds } = setup();
    broker.open("a1", approvalAsk);
    expect(shown).toEqual([{ id: "a1", ask: approvalAsk }]);
    expect(holds()).toBe(1);

    expect(broker.answer("a1", { decision: "approve" })).toBeUndefined();
    expect(answers).toEqual([["a1", { decision: "approve" }]]);
    expect(holds()).toBe(0);
    expect(broker.answer("a1", { decision: "approve" })).toBe("unknown_ask");
    expect(answers).toHaveLength(1);
  });

  it("refuses an answer the question doesn't allow, and keeps it open", () => {
    const { broker, answers } = setup();
    broker.open("a1", sessionOnly);
    expect(broker.answer("a1", { decision: "allow", lifetime: "always" })).toBe("invalid_request");
    expect(broker.answer("a1", { decision: "timeout" })).toBe("invalid_request");
    expect(answers).toEqual([]);
    expect(broker.openCount).toBe(1);
  });

  it("refuses answers to ids it never opened", () => {
    const { broker } = setup();
    expect(broker.answer("nope", { decision: "deny" })).toBe("unknown_ask");
  });

  it("answers timeout at once when there's no window to ask in", () => {
    const { broker, answers, holds } = setup({ window: false });
    broker.open("a1", approvalAsk);
    expect(answers).toEqual([["a1", { decision: "timeout" }]]);
    expect(holds()).toBe(0);
    expect(broker.openCount).toBe(0);
  });

  it("expires a question after 5 minutes: timeout to host, closed to the window", () => {
    const { broker, answers, closed, holds } = setup();
    broker.open("a1", approvalAsk);
    vi.advanceTimersByTime(ASK_EXPIRY_MS - 1);
    expect(answers).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(answers).toEqual([["a1", { decision: "timeout" }]]);
    expect(closed).toEqual(["a1"]);
    expect(holds()).toBe(0);
    expect(broker.answer("a1", { decision: "approve" })).toBe("unknown_ask");
  });

  it("drops every question when host goes down, without answering a dead host", () => {
    const { broker, answers, closed, holds } = setup();
    broker.open("a1", approvalAsk);
    broker.open("a2", grantAsk);
    broker.dropAll();
    expect(closed).toEqual(["a1", "a2"]);
    expect(answers).toEqual([]);
    expect(holds()).toBe(0);
    vi.advanceTimersByTime(ASK_EXPIRY_MS);
    expect(answers).toEqual([]);
  });

  it("shows open questions again after a reload", () => {
    const { broker, shown } = setup();
    broker.open("a1", approvalAsk);
    broker.reshow();
    expect(shown).toHaveLength(2);
  });

  it("ignores a reused open id", () => {
    const { broker, shown } = setup();
    broker.open("a1", approvalAsk);
    broker.open("a1", grantAsk);
    expect(shown).toHaveLength(1);
  });
});
