import type { Log, MainToHost, PermissionAsk } from "@totum/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CALL_TIMEOUT_MS, HostClient, QUERY_TIMEOUT_MS } from "./host-client.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const call = { taskId: "t1", capability: "test.echo", input: { text: "hi" }, shapedByUntrusted: false };

function setup(post: (m: MainToHost) => boolean = () => true) {
  const posted: MainToHost[] = [];
  const asks: Array<[string, PermissionAsk]> = [];
  const log = vi.fn<Log>();
  let downs = 0;
  let next = 1;
  const client = new HostClient({
    post: (m) => {
      posted.push(m);
      return post(m);
    },
    log,
    onAsk: (askId, ask) => asks.push([askId, ask]),
    onDown: () => downs++,
    newId: () => id(next++),
  });
  client.markUp();
  return { client, posted, asks, log, downs: () => downs };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("HostClient: calls", () => {
  it("posts a capability.request with origin agent and resolves with the matching result", async () => {
    const { client, posted } = setup();
    const result = client.call(call);
    expect(posted).toEqual([{ type: "capability.request", id: id(1), origin: "agent", call }]);
    client.receive({ type: "capability.result", id: id(1), result: { ok: true, output: { text: "hi" }, untrusted: false } });
    await expect(result).resolves.toEqual({ ok: true, output: { text: "hi" }, untrusted: false });
    expect(client.pendingCount).toBe(0);
  });

  it("drops results with unknown or repeated ids", async () => {
    const { client, log } = setup();
    const result = client.call(call);
    const ok = { type: "capability.result", id: id(1), result: { ok: true, output: 1, untrusted: false } };
    client.receive({ ...ok, id: id(99) });
    client.receive(ok);
    client.receive(ok);
    await expect(result).resolves.toMatchObject({ ok: true });
    expect(log).toHaveBeenCalledTimes(2);
  });

  it("answers host_unavailable when host is down, can't be posted to, or goes down mid-call", async () => {
    const down = setup();
    down.client.markDown("restarting");
    await expect(down.client.call(call)).resolves.toMatchObject({ ok: false, code: "host_unavailable" });

    const unpostable = setup(() => false);
    await expect(unpostable.client.call(call)).resolves.toMatchObject({ ok: false, code: "host_unavailable" });

    const mid = setup();
    const pending = mid.client.call(call);
    mid.client.markDown("The host stopped unexpectedly.");
    await expect(pending).resolves.toMatchObject({ ok: false, code: "host_unavailable", message: "The host stopped unexpectedly." });
    expect(mid.downs()).toBe(1);
  });

  it("gives up on a stuck host after the long call timeout", async () => {
    const { client } = setup();
    const pending = client.call(call);
    vi.advanceTimersByTime(CALL_TIMEOUT_MS);
    await expect(pending).resolves.toMatchObject({ ok: false, code: "host_unavailable" });
  });
});

describe("HostClient: queries", () => {
  it("resolves with the reply of the same kind", async () => {
    const { client, posted } = setup();
    const outcome = client.query({ kind: "grants.list" });
    expect(posted).toEqual([{ type: "host.query", id: id(1), origin: "ui", query: { kind: "grants.list" } }]);
    client.receive({ type: "host.reply", id: id(1), reply: { kind: "grants.list", grants: [] } });
    await expect(outcome).resolves.toEqual({ ok: true, reply: { kind: "grants.list", grants: [] } });
  });

  it("fails a reply of the wrong kind", async () => {
    const { client } = setup();
    const outcome = client.query({ kind: "grants.list" });
    client.receive({ type: "host.reply", id: id(1), reply: { kind: "grants.revoke" } });
    await expect(outcome).resolves.toMatchObject({ ok: false });
  });

  it("times out after 5 seconds", async () => {
    const { client } = setup();
    const outcome = client.query({ kind: "audit.list" });
    vi.advanceTimersByTime(QUERY_TIMEOUT_MS);
    await expect(outcome).resolves.toMatchObject({ ok: false });
  });
});

describe("HostClient: asks and answers", () => {
  it("hands permission asks to the broker and posts answers", () => {
    const { client, asks, posted } = setup();
    const ask = {
      kind: "approval",
      taskId: "t1",
      capability: "test.danger",
      tier: 2,
      scope: { kind: "app", app: "x" },
      action: "Delete",
      shapedByUntrusted: false,
    };
    client.receive({ type: "permission.ask", id: id(7), ask });
    expect(asks).toEqual([[id(7), ask]]);
    expect(client.answer(id(7), { decision: "approve" })).toBe(true);
    expect(posted).toEqual([{ type: "permission.answer", id: id(7), decision: { decision: "approve" } }]);
  });

  it("drops invalid messages from host, including asks that break the schema", () => {
    const { client, asks, log } = setup();
    client.receive({ type: "permission.ask", id: id(7), ask: { kind: "approval", action: "x" } });
    client.receive({ type: "agent.reply", id: id(1), text: "hi" });
    client.receive("nonsense");
    expect(asks).toEqual([]);
    expect(log).toHaveBeenCalledTimes(3);
  });
});
