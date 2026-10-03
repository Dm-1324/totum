import type { Log, MainToAgent } from "@totum/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentClient, AgentRequestError, DEFAULT_TIMEOUT_MS } from "./agent-client.js";

const ids = [
  "00000000-0000-4000-8000-000000000001",
  "00000000-0000-4000-8000-000000000002",
  "00000000-0000-4000-8000-000000000003",
];
const unknownId = "00000000-0000-4000-8000-0000000000ff";

function setup(post: (m: MainToAgent) => boolean = () => true) {
  const log = vi.fn<Log>();
  const posted: MainToAgent[] = [];
  let next = 0;
  const client = new AgentClient({
    post: (m) => {
      posted.push(m);
      return post(m);
    },
    log,
    newId: () => ids[next++] ?? "",
  });
  client.markUp();
  return { client, log, posted };
}

const reply = (id: string, text: string) => ({ type: "agent.reply", id, text });

/** Settles a promise into a plain value so tests can check it without awaiting a hang. */
function track<T>(p: Promise<T>) {
  const state: { value?: T; error?: unknown; settled: boolean } = { settled: false };
  p.then(
    (value) => Object.assign(state, { value, settled: true }),
    (error: unknown) => Object.assign(state, { error, settled: true }),
  );
  return state;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("AgentClient: replies are matched by id", () => {
  it("posts an agent.message and resolves with the matching reply", async () => {
    const { client, posted } = setup();
    const result = client.send("hello");
    expect(posted).toEqual([{ type: "agent.message", id: ids[0], text: "hello" }]);
    client.receive(reply(ids[0]!, "agent: hello"));
    await expect(result).resolves.toBe("agent: hello");
    expect(client.pendingCount).toBe(0);
  });

  it("delivers out-of-order replies to the right requests", async () => {
    const { client } = setup();
    const first = client.send("one");
    const second = client.send("two");
    client.receive(reply(ids[1]!, "agent: two"));
    client.receive(reply(ids[0]!, "agent: one"));
    await expect(first).resolves.toBe("agent: one");
    await expect(second).resolves.toBe("agent: two");
  });

  it("drops and logs a reply with an unknown id, leaving pending requests alone", async () => {
    const { client, log } = setup();
    const result = track(client.send("hello"));
    client.receive(reply(unknownId, "agent: not for you"));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.settled).toBe(false);
    expect(client.pendingCount).toBe(1);
    expect(log).toHaveBeenCalledWith("warn", "main: dropped agent reply with unknown id", { id: unknownId });
  });

  it("drops and logs a duplicate reply; the first one wins", async () => {
    const { client, log } = setup();
    const first = client.send("one");
    client.receive(reply(ids[0]!, "agent: one"));
    client.receive(reply(ids[0]!, "agent: forged"));
    await expect(first).resolves.toBe("agent: one");
    expect(log).toHaveBeenCalledWith("warn", "main: dropped agent reply with already answered or timed out id", {
      id: ids[0],
    });
  });

  it("never delivers a duplicate to a later request", async () => {
    const { client } = setup();
    const first = client.send("one");
    client.receive(reply(ids[0]!, "agent: one"));
    await first;
    const second = track(client.send("two"));
    client.receive(reply(ids[0]!, "agent: replayed"));
    await vi.advanceTimersByTimeAsync(0);
    expect(second.settled).toBe(false);
    client.receive(reply(ids[1]!, "agent: two"));
    await vi.advanceTimersByTimeAsync(0);
    expect(second.value).toBe("agent: two");
  });

  it("drops and logs a late reply after the request timed out", async () => {
    const { client, log } = setup();
    const result = client.send("hello").catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    expect(await result).toBeInstanceOf(AgentRequestError);
    client.receive(reply(ids[0]!, "agent: too late"));
    expect(log).toHaveBeenCalledWith("warn", "main: dropped agent reply with already answered or timed out id", {
      id: ids[0],
    });
  });

  it("drops and logs a malformed message without touching pending requests", async () => {
    const { client, log } = setup();
    const result = track(client.send("hello"));
    client.receive({ type: "agent.reply", id: ids[0], text: "x", extra: true });
    client.receive("garbage");
    await vi.advanceTimersByTimeAsync(0);
    expect(result.settled).toBe(false);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("warn", "main: dropped invalid message from agent", expect.anything());
  });
});

describe("AgentClient: a request never hangs", () => {
  it(`times out after ${DEFAULT_TIMEOUT_MS} ms with agent_timeout`, async () => {
    const { client } = setup();
    const result = track(client.send("hello"));
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(result.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(result.error).toBeInstanceOf(AgentRequestError);
    expect((result.error as AgentRequestError).code).toBe("agent_timeout");
    expect((result.error as AgentRequestError).message).toBe("The agent didn't answer within 10 seconds.");
    expect(client.pendingCount).toBe(0);
  });

  it("fails every pending request at once when the agent goes down", async () => {
    const { client } = setup();
    const a = track(client.send("one"));
    const b = track(client.send("two"));
    client.markDown("The agent stopped unexpectedly and is restarting. Try again in a moment.");
    await vi.advanceTimersByTimeAsync(0);
    for (const r of [a, b]) {
      expect((r.error as AgentRequestError).code).toBe("agent_unavailable");
      expect((r.error as AgentRequestError).message).toContain("stopped unexpectedly");
    }
    expect(client.pendingCount).toBe(0);
  });

  it("fails fast while the agent is down, and works again once it's back", async () => {
    const { client, posted } = setup();
    client.markDown("The agent stopped and couldn't be restarted. Restart Totum.");
    await expect(client.send("hello")).rejects.toMatchObject({ code: "agent_unavailable" });
    expect(posted).toEqual([]);
    client.markUp();
    const result = client.send("hello");
    client.receive(reply(ids[0]!, "agent: hello"));
    await expect(result).resolves.toBe("agent: hello");
  });

  it("fails fast before the agent has started", async () => {
    const client = new AgentClient({ post: () => true, log: vi.fn<Log>() });
    await expect(client.send("hello")).rejects.toMatchObject({ code: "agent_unavailable" });
  });

  it("fails fast when the message can't be posted", async () => {
    const { client } = setup(() => false);
    await expect(client.send("hello")).rejects.toMatchObject({ code: "agent_unavailable" });
    expect(client.pendingCount).toBe(0);
  });

  it("leaves no timers behind once every request settles", async () => {
    const { client } = setup();
    const result = client.send("hello");
    client.receive(reply(ids[0]!, "agent: hello"));
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("AgentClient: task id and holds", () => {
  it("names the task only while exactly one user message is in flight", async () => {
    const { client } = setup();
    expect(client.taskId()).toBeUndefined();
    const first = client.send("one");
    expect(client.taskId()).toBe(ids[0]);
    const second = client.send("two");
    expect(client.taskId()).toBeUndefined();
    client.receive(reply(ids[0]!, "a"));
    client.receive(reply(ids[1]!, "b"));
    await Promise.all([first, second]);
    expect(client.taskId()).toBeUndefined();
  });

  it("doesn't time out while held, then gives the full timeout again", async () => {
    const { client } = setup();
    const state = track(client.send("hello"));
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    const release = client.hold();
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS * 10);
    expect(state.settled).toBe(false);
    release();
    release(); // idempotent
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS - 1);
    expect(state.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(state.error).toBeInstanceOf(AgentRequestError);
  });

  it("stays held until the last of several holds is released, including for requests sent while held", async () => {
    const { client } = setup();
    const a = client.hold();
    const b = client.hold();
    const state = track(client.send("sent while held"));
    a();
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS * 2);
    expect(state.settled).toBe(false);
    b();
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    expect(state.settled).toBe(true);
  });

  it("hands capability requests to the relay and posts results", () => {
    const requests: unknown[] = [];
    const posted: MainToAgent[] = [];
    const client = new AgentClient({
      post: (m) => {
        posted.push(m);
        return true;
      },
      log: vi.fn<Log>(),
      onCapabilityRequest: (m) => requests.push(m),
    });
    const request = {
      type: "capability.request",
      id: ids[0],
      call: { capability: "test.echo", input: { text: "hi" }, shapedByUntrusted: false },
    };
    client.receive(request);
    expect(requests).toEqual([request]);
    client.postResult(ids[0]!, { ok: true, output: 1, untrusted: false });
    expect(posted).toEqual([{ type: "capability.result", id: ids[0], result: { ok: true, output: 1, untrusted: false } }]);
  });
});
