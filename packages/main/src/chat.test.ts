import { ChatSendReply, MAX_TEXT_LENGTH, type Log, type MainToAgent } from "@totum/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentClient, DEFAULT_TIMEOUT_MS } from "./agent-client.js";
import { handleChatSend } from "./chat.js";
import { FakeChild } from "./fake-child.js";
import type { SenderInfo, TrustedRenderer } from "./sender.js";
import { Supervisor } from "./supervisor.js";

const TRUSTED: TrustedRenderer = { webContentsId: 1, url: "http://localhost:5173/" };
const OURS: SenderInfo = { webContentsId: 1, isMainFrame: true, url: "http://localhost:5173/" };

/** Main's agent wiring as in index.ts, with a fake agent process. */
function wire() {
  const log = vi.fn<Log>();
  const children: FakeChild[] = [];
  const client: AgentClient = new AgentClient({ post: (m) => agent.post(m), log });
  const agent = new Supervisor({
    name: "agent",
    spawn: () => {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    log,
    onMessage: (m) => client.receive(m),
    onUp: () => client.markUp(),
    onDown: (reason) => client.markDown(reason),
    restartDelayMs: () => 100,
  });
  agent.start();
  const child = () => children[children.length - 1]!;
  child().emitSpawn();
  /** Make the current child answer every message the way the real agent does. */
  const echo = () => {
    const c = child();
    const original = c.postMessage.bind(c);
    c.postMessage = (m) => {
      original(m);
      const msg = m as MainToAgent;
      if (msg.type !== "agent.message") return;
      queueMicrotask(() => c.emitMessage({ type: "agent.reply", id: msg.id, text: `agent: ${msg.text}` }));
    };
  };
  const deps = { agent: client, log, trusted: () => TRUSTED };
  const send = (raw: unknown) => handleChatSend(OURS, raw, deps);
  const sendFrom = (sender: SenderInfo, raw: unknown) => handleChatSend(sender, raw, deps);
  return { agent, client, child, echo, send, sendFrom, log };
}

function track<T>(p: Promise<T>) {
  const state: { value?: T; settled: boolean } = { settled: false };
  void p.then((value) => Object.assign(state, { value, settled: true }));
  return state;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("chat.send", () => {
  it("returns the agent's reply", async () => {
    const { echo, send } = wire();
    echo();
    await expect(send({ text: "hello" })).resolves.toEqual({ ok: true, text: "agent: hello" });
  });

  it("rejects an invalid request without bothering the agent", async () => {
    const { child, send } = wire();
    for (const bad of [{ text: "" }, { text: "a".repeat(MAX_TEXT_LENGTH + 1) }, { text: "hi", extra: 1 }, "hi"]) {
      const reply = await send(bad);
      expect(reply).toMatchObject({ ok: false, code: "invalid_request" });
    }
    expect(child().posted).toEqual([]);
  });

  it("every reply is a valid ChatSendReply", async () => {
    const { echo, send } = wire();
    echo();
    expect(ChatSendReply.safeParse(await send({ text: "hello" })).success).toBe(true);
    expect(ChatSendReply.safeParse(await send({ text: "" })).success).toBe(true);
  });
});

describe("chat.send never hangs the UI", () => {
  it("returns agent_timeout when the agent doesn't answer in time", async () => {
    const { send } = wire();
    const reply = track(send({ text: "hello" }));
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(reply.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(reply.value).toEqual({
      ok: false,
      code: "agent_timeout",
      message: "The agent didn't answer within 10 seconds.",
    });
  });

  it("returns agent_unavailable at once when the agent crashes mid-request", async () => {
    const { child, send } = wire();
    const reply = track(send({ text: "hello" }));
    child().emitExit(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(reply.value).toEqual({
      ok: false,
      code: "agent_unavailable",
      message: "The agent stopped unexpectedly and is restarting. Try again in a moment.",
    });
  });

  it("returns agent_unavailable while the agent restarts, then works again", async () => {
    const { child, echo, send } = wire();
    child().emitExit(1);
    await expect(send({ text: "hello" })).resolves.toMatchObject({ code: "agent_unavailable" });

    await vi.advanceTimersByTimeAsync(100);
    child().emitSpawn();
    echo();
    await expect(send({ text: "hello" })).resolves.toEqual({ ok: true, text: "agent: hello" });
  });

  it("reports the agent as down once it can't be restarted", async () => {
    const { child, send } = wire();
    for (let i = 0; i < 3; i++) {
      child().emitExit(1);
      await vi.advanceTimersByTimeAsync(100);
    }
    child().emitExit(1);
    await expect(send({ text: "hello" })).resolves.toEqual({
      ok: false,
      code: "agent_unavailable",
      message: "The agent stopped and couldn't be restarted. Restart Totum.",
    });
  });

  it("returns agent_unavailable after the agent was stopped for quit", async () => {
    const { agent, send } = wire();
    const reply = track(send({ text: "hello" }));
    await agent.stop();
    await vi.advanceTimersByTimeAsync(0);
    expect(reply.value).toMatchObject({ ok: false, code: "agent_unavailable" });
  });
});

describe("chat.send only answers our window", () => {
  const others: Array<[string, SenderInfo]> = [
    ["another window", { ...OURS, webContentsId: 2 }],
    ["an iframe in our window", { ...OURS, isMainFrame: false }],
    ["our window after navigating elsewhere", { ...OURS, url: "https://evil.example/" }],
    ["another local dev port", { ...OURS, url: "http://localhost:5174/" }],
    ["another page on our dev server", { ...OURS, url: "http://localhost:5173/other.html" }],
    ["a local file", { ...OURS, url: "file:///C:/Users/someone/Downloads/page.html" }],
    ["a frame that is gone", { ...OURS, url: undefined }],
  ];

  it.each(others)("rejects a request from %s without contacting the agent", async (_name, sender) => {
    const { child, echo, sendFrom, log } = wire();
    echo();
    await expect(sendFrom(sender, { text: "hello" })).resolves.toEqual({
      ok: false,
      code: "untrusted_sender",
      message: "Request refused: it didn't come from the Totum window.",
    });
    expect(child().posted).toEqual([]);
    expect(log).toHaveBeenCalledWith("warn", "main: rejected chat.send from untrusted sender", expect.anything());
  });

  it("rejects everything before our window exists", async () => {
    const log = vi.fn<Log>();
    const agent = { send: vi.fn(async () => "agent: hi") };
    const reply = await handleChatSend(OURS, { text: "hi" }, { agent, log, trusted: () => undefined });
    expect(reply).toMatchObject({ ok: false, code: "untrusted_sender" });
    expect(agent.send).not.toHaveBeenCalled();
  });

  it("does not log the sender's URL", async () => {
    const { sendFrom, log } = wire();
    await sendFrom({ ...OURS, url: "https://evil.example/?token=secret" }, { text: "hello" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });
});
