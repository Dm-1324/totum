// The dev `/call` command end to end: the real agent (createAgent + runDevCall,
// as a dev build wires it) behind main's real AgentClient, router and taint,
// in front of the real host handler, engine and in-memory SQLite. Only the UI
// window is a fake. Proves `/call` takes the model's path: the agent sends an
// AgentCapabilityRequest, main stamps the task id of the chat message in
// flight, and nothing reaches host outside a user message.
import { runDevCall } from "@totum/agent/src/dev-call.js";
import { createAgent } from "@totum/agent/src/handler.js";
import { makeEngine } from "@totum/host/src/engine.fixture.js";
import { HostHandler } from "@totum/host/src/handler.js";
import { type Log, type PermissionDecision, TEST_CAPABILITY_SPECS, type UiPermissionAsk } from "@totum/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentClient } from "./agent-client.js";
import { HostClient } from "./host-client.js";
import { PermissionBroker } from "./permissions.js";
import { AgentTaint, relayCapabilityRequest } from "./router.js";

const hop = (fn: () => void) => queueMicrotask(fn);
const flush = () => vi.advanceTimersByTimeAsync(0);

function world({ dev = true } = {}) {
  const log: Log = () => {};
  const host = makeEngine();
  const shown: UiPermissionAsk[] = [];
  const taint = new AgentTaint();
  const chatIds: string[] = [];

  const agent = createAgent({
    post: (message) => hop(() => agentClient.receive(message)),
    log,
    known: new Set(dev ? TEST_CAPABILITY_SPECS.map((s) => s.id) : []),
    command: dev ? runDevCall : undefined,
  });

  const agentClient: AgentClient = new AgentClient({
    post: (message) => {
      hop(() => agent.receive(message));
      return true;
    },
    log,
    newId: () => {
      const id = crypto.randomUUID();
      chatIds.push(id);
      return id;
    },
    onCapabilityRequest: (message) => relayCapabilityRequest(message, { agent: agentClient, host: hostClient, taint, log }),
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
    closed: () => {},
    hold: () => agentClient.hold(),
    minShownMs: 0,
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

  const answer = (decision: PermissionDecision) => broker.answer(shown.at(-1)!.id, decision);
  /** Sends a chat message, answering each ask in turn; resolves with the reply text. */
  async function chat(text: string, ...decisions: PermissionDecision[]): Promise<string> {
    const reply = agentClient.send(text);
    for (const decision of decisions) {
      const before = shown.length;
      await vi.waitFor(() => expect(shown.length).toBe(before + 1));
      answer(decision);
    }
    await flush();
    return reply;
  }

  return { host, shown, taint, chatIds, agent, chat, audit: () => host.audit.list() };
}

const allowSession: PermissionDecision = { decision: "allow", lifetime: "session" };
const allowAlways: PermissionDecision = { decision: "allow", lifetime: "always" };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("/call end to end", () => {
  it("asks for a grant, runs, and stamps the chat message's id as the task", async () => {
    const w = world();
    const reply = await w.chat('/call test.note {"text":"buy milk"}', allowSession);
    expect(reply).toMatch(/^test\.note: ok\n/);
    expect(w.shown.map((s) => s.ask)).toEqual([expect.objectContaining({ kind: "grant", taskId: w.chatIds[0] })]);
    expect(w.audit()).toEqual([expect.objectContaining({ capability: "test.note", taskId: w.chatIds[0], outcome: "ok" })]);
  });

  it("labels test.echo's output untrusted, and taints every later call", async () => {
    const w = world();
    expect(await w.chat('/call test.note {"text":"a"}', allowAlways)).toMatch(/^test\.note: ok/);
    expect(w.taint.tainted).toBe(false);

    const echoed = await w.chat('/call test.echo {"text":"hi"}', allowSession);
    expect(echoed.split("\n")[0]).toBe("test.echo: ok, untrusted output (shown as data)");
    expect(w.taint.tainted).toBe(true);

    // test.note has an `always` grant, yet now asks approval: main raised shapedByUntrusted.
    const asksBefore = w.shown.length;
    expect(await w.chat('/call test.note {"text":"b"}', { decision: "approve" })).toMatch(/^test\.note: ok/);
    expect(w.shown.slice(asksBefore).map((s) => s.ask)).toEqual([
      expect.objectContaining({ kind: "approval", capability: "test.note", shapedByUntrusted: true }),
    ]);
  });

  it("blocks a tier-2 call until approved, and a reject runs nothing", async () => {
    const w = world();
    w.host.db.exec("insert into test_notes (text) values ('a')");
    const reply = await w.chat("/call test.danger {}", allowSession, { decision: "deny" });
    expect(reply).toMatch(/^test\.danger failed: rejected\n/);
    expect(w.host.db.prepare("select count(*) as n from test_notes").get()?.["n"]).toBe(1);
  });

  it("refuses a request the agent makes outside a user message; host never sees it", async () => {
    const w = world();
    const result = w.agent.capabilities.request({ capability: "test.note", input: { text: "x" }, shapedByUntrusted: false });
    await flush();
    expect(await result).toMatchObject({ ok: false, code: "no_task" });
    expect(w.shown).toEqual([]);
    expect(w.audit()).toEqual([]);
  });

  it("with __TOTUM_DEV__ off, /call is echoed and nothing reaches host", async () => {
    const w = world({ dev: false });
    expect(await w.chat("/call test.danger {}")).toBe("agent: /call test.danger {}");
    expect(w.shown).toEqual([]);
    expect(w.audit()).toEqual([]);
  });
});
