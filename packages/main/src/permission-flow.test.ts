// Milestone 2's done-when, end to end in one process: "A tier-2 call blocks
// until approved; every call appears in the log." Real host handler, engine
// and SQLite (in memory); real main HostClient, PermissionBroker, AgentClient,
// router and chat handler. Only the agent and the UI window are fakes, and
// every hop goes through a microtask the way a real port would.
import { makeEngine } from "@totum/host/src/engine.fixture.js";
import { HostHandler } from "@totum/host/src/handler.js";
import {
  type AgentCall,
  AgentToMain,
  type CapabilityResult,
  type Log,
  MainToAgent,
  type PermissionDecision,
  type UiPermissionAsk,
} from "@totum/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentClient, DEFAULT_TIMEOUT_MS } from "./agent-client.js";
import { handleChatSend } from "./chat.js";
import { HostClient } from "./host-client.js";
import { ASK_EXPIRY_MS, PermissionBroker } from "./permissions.js";
import { handleAuditList, handlePermissionAnswer, relayCapabilityRequest, AgentTaint, type UiDeps } from "./router.js";
import type { SenderInfo, TrustedRenderer } from "./sender.js";

const TRUSTED: TrustedRenderer = { webContentsId: 1, url: "file:///C:/totum/out/renderer/index.html" };
const OURS: SenderInfo = { webContentsId: 1, isMainFrame: true, url: TRUSTED.url };
const OTHER: SenderInfo = { webContentsId: 2, isMainFrame: true, url: "https://evil.example/" };

/** Messages cross "ports" asynchronously, like real IPC. */
const hop = (fn: () => void) => queueMicrotask(fn);

function world() {
  const log: Log = () => {};
  const host = makeEngine();
  const shown: UiPermissionAsk[] = [];
  const closed: string[] = [];

  // The fake agent: a chat message "call <json>" makes it send that capability
  // request; when the result comes back it replies with the result as JSON.
  const agentCalls = new Map<string, string>(); // capability request id -> chat message id
  const agentPost = (raw: unknown) => {
    const message = MainToAgent.parse(raw);
    hop(() => {
      if (message.type === "agent.message") {
        const call = JSON.parse(message.text.replace(/^call /, "")) as AgentCall;
        const requestId = crypto.randomUUID();
        agentCalls.set(requestId, message.id);
        agentClient.receive(AgentToMain.parse({ type: "capability.request", id: requestId, call }));
      } else {
        const chatId = agentCalls.get(message.id);
        if (chatId) agentClient.receive({ type: "agent.reply", id: chatId, text: JSON.stringify(message.result) });
      }
    });
    return true;
  };

  const agentClient: AgentClient = new AgentClient({
    post: agentPost,
    log,
    onCapabilityRequest: (message) => relayCapabilityRequest(message, { agent: agentClient, host: hostClient, taint: new AgentTaint(), log }),
  });
  agentClient.markUp();

  const handler: HostHandler = new HostHandler({
    engine: host.engine,
    grants: host.grants,
    audit: host.audit,
    log,
    post: (message) => hop(() => hostClient.receive(message)),
  });

  const broker = new PermissionBroker({
    answer: (id, decision) => hostClient.answer(id, decision),
    show: (payload) => {
      shown.push(payload);
      return true;
    },
    closed: (id) => closed.push(id),
    hold: () => agentClient.hold(),
    log,
  });

  const hostClient: HostClient = new HostClient({
    post: (message) => {
      hop(() => handler.handle(message));
      return true;
    },
    log,
    onAsk: (id, ask) => broker.open(id, ask),
    onDown: () => broker.dropAll(),
  });
  hostClient.markUp();

  const ui: UiDeps = { trusted: () => TRUSTED, broker, host: hostClient, log };

  /** The user types a chat message; resolves with the chat reply. */
  const chat = (call: AgentCall) =>
    handleChatSend(OURS, { text: `call ${JSON.stringify(call)}` }, { agent: agentClient, log, trusted: () => TRUSTED });
  const answer = (decision: PermissionDecision, from = OURS) => {
    const open = shown.at(-1)!;
    return handlePermissionAnswer(from, { id: open.id, decision }, ui);
  };
  const result = async (reply: Awaited<ReturnType<typeof chat>>): Promise<CapabilityResult> => {
    if (!reply.ok) throw new Error(`chat failed: ${reply.code}`);
    return JSON.parse(reply.text) as CapabilityResult;
  };
  const notes = () => host.db.prepare("select count(*) as n from test_notes").get()?.["n"];
  const auditRows = async () => {
    const reply = await handleAuditList(OURS, {}, ui);
    if (!reply.ok) throw new Error(reply.message);
    return reply.entries;
  };

  return { host, shown, closed, chat, answer, result, notes, auditRows, agentClient, hostClient, ui };
}

/** Lets every queued hop run. */
const flush = () => vi.advanceTimersByTimeAsync(0);
const danger: AgentCall = { capability: "test.danger", input: {}, shapedByUntrusted: false };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("permission flow: a tier-2 call blocks until approved", () => {
  it("waits for the user, past the agent's own timeout, and runs only after Approve", async () => {
    const w = world();
    w.host.db.exec("insert into test_notes (text) values ('a'), ('b')");
    let settled = false;
    const reply = w.chat(danger).then((r) => {
      settled = true;
      return r;
    });

    await flush();
    expect(w.shown.map((s) => s.ask.kind)).toEqual(["grant"]);
    expect(w.answer({ decision: "allow", lifetime: "session" })).toEqual({ ok: true });

    await flush();
    expect(w.shown.map((s) => s.ask.kind)).toEqual(["grant", "approval"]);
    expect(w.shown[1]!.ask).toMatchObject({ capability: "test.danger", action: expect.stringContaining("Delete all 2") });

    // Blocked: nothing ran, the row is pending, and the chat outlives its 10 s timeout.
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS * 3);
    expect(settled).toBe(false);
    expect(w.notes()).toBe(2);
    expect(w.host.audit.list()[0]).toMatchObject({ capability: "test.danger", outcome: "pending" });

    expect(w.answer({ decision: "approve" })).toEqual({ ok: true });
    await flush();
    expect(await w.result(await reply)).toEqual({ ok: true, output: { cleared: 2 }, untrusted: false });
    expect(w.notes()).toBe(0);
    expect(w.host.audit.list()[0]).toMatchObject({ outcome: "ok", approver: "user" });
  });

  it("Reject means nothing runs, and the agent hears rejected", async () => {
    const w = world();
    w.host.db.exec("insert into test_notes (text) values ('keep')");
    const reply = w.chat(danger);
    await flush();
    w.answer({ decision: "allow", lifetime: "session" });
    await flush();
    w.answer({ decision: "deny" });
    await flush();
    expect(await w.result(await reply)).toMatchObject({ ok: false, code: "rejected" });
    expect(w.notes()).toBe(1);
  });

  it("only the Totum window can answer, and only with answers the question allows", async () => {
    const w = world();
    void w.chat(danger);
    await flush();
    expect(w.answer({ decision: "allow", lifetime: "session" }, OTHER)).toMatchObject({ ok: false, code: "untrusted_sender" });
    expect(w.answer({ decision: "allow", lifetime: "always" })).toMatchObject({ ok: false, code: "invalid_request" });
    expect(w.answer({ decision: "approve" })).toMatchObject({ ok: false, code: "invalid_request" });
    expect(handlePermissionAnswer(OURS, { id: crypto.randomUUID(), decision: { decision: "deny" } }, w.ui)).toMatchObject({
      ok: false,
      code: "unknown_ask",
    });
    expect(w.host.grants.list()).toEqual([]);
  });

  it("no answer for 5 minutes: approval_timeout, nothing runs, the dialog closes", async () => {
    const w = world();
    w.host.db.exec("insert into test_notes (text) values ('keep')");
    const reply = w.chat(danger);
    await flush();
    w.answer({ decision: "allow", lifetime: "session" });
    await flush();
    await vi.advanceTimersByTimeAsync(ASK_EXPIRY_MS);
    expect(await w.result(await reply)).toMatchObject({ ok: false, code: "approval_timeout" });
    expect(w.closed).toEqual([w.shown[1]!.id]);
    expect(w.notes()).toBe(1);
  });
});

describe("permission flow: every call appears in the log", () => {
  it("logs one row per call, whatever happened to it", async () => {
    const w = world();
    const calls: Array<{ call: AgentCall; answers: PermissionDecision[]; code: string }> = [
      { call: { capability: "test.echo", input: { text: "hi" }, shapedByUntrusted: false }, answers: [{ decision: "allow", lifetime: "always" }], code: "ok" },
      { call: { capability: "test.note", input: { text: "x" }, shapedByUntrusted: false }, answers: [{ decision: "deny" }], code: "not_granted" },
      { call: { capability: "test.echo", input: { nope: 1 }, shapedByUntrusted: false }, answers: [], code: "invalid_input" },
      { call: { capability: "files.nuke", input: {}, shapedByUntrusted: false }, answers: [], code: "unknown_capability" },
      { call: danger, answers: [{ decision: "allow", lifetime: "session" }, { decision: "deny" }], code: "rejected" },
      { call: danger, answers: [{ decision: "approve" }], code: "ok" },
    ];
    for (const { call, answers, code } of calls) {
      const reply = w.chat(call);
      for (const decision of answers) {
        await flush();
        expect(w.answer(decision)).toEqual({ ok: true });
      }
      await flush();
      const result = await w.result(await reply);
      expect(result.ok ? "ok" : result.code, call.capability).toBe(code);
    }

    const rows = await w.auditRows();
    expect(rows.map((r) => [r.capability, r.outcome]).reverse()).toEqual(
      calls.map(({ call, code }) => [call.capability, code]),
    );
    // Each call is its own chat message, so its own task.
    expect(new Set(rows.map((r) => r.taskId)).size).toBe(calls.length);
  });

  it("refuses a capability request the agent makes on its own, before host sees it", async () => {
    const w = world();
    const results: unknown[] = [];
    const agent = new AgentClient({
      post: (m) => {
        results.push(m);
        return true;
      },
      log: () => {},
      onCapabilityRequest: (message) => relayCapabilityRequest(message, { agent, host: w.hostClient, taint: new AgentTaint(), log: () => {} }),
    });
    agent.markUp();
    agent.receive({ type: "capability.request", id: crypto.randomUUID(), call: danger });
    await flush();
    expect(results).toMatchObject([{ type: "capability.result", result: { ok: false, code: "no_task" } }]);
    expect(await w.auditRows()).toEqual([]);
  });

  it("the agent can't pick its own task id", async () => {
    const w = world();
    const agent = new AgentClient({ post: () => true, log: () => {} });
    expect(() => AgentToMain.parse({ type: "capability.request", id: crypto.randomUUID(), call: { ...danger, taskId: "mine" } })).toThrow();
    agent.receive({ type: "capability.request", id: crypto.randomUUID(), call: { ...danger, taskId: "mine" } });
    await flush();
    expect(await w.auditRows()).toEqual([]);
  });
});
