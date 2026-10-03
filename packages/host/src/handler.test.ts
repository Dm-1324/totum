import { HostToMain, type HostToMain as HostToMainT } from "@totum/shared";
import { describe, expect, it, vi } from "vitest";
import { NOTES_APP } from "./capabilities/test-capabilities.js";
import { makeEngine, settle } from "./engine.fixture.js";
import { HostHandler, readyMessage, toWire } from "./handler.js";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup(options: { askBackstopMs?: number } = {}) {
  const f = makeEngine();
  const posted: HostToMainT[] = [];
  let next = 100;
  const handler = new HostHandler({
    engine: f.engine,
    grants: f.grants,
    audit: f.audit,
    log: (level, message) => f.logs.push({ level, message }),
    post: (m) => posted.push(m),
    newId: () => id(next++),
    ...options,
  });
  return { ...f, handler, posted };
}

const request = (n: number, capability: string, input: unknown, taskId = "task-1") => ({
  type: "capability.request",
  id: id(n),
  origin: "agent",
  call: { taskId, capability, input, shapedByUntrusted: false },
});

describe("host handler", () => {
  it("announces readiness with a valid host.ready", () => {
    expect(HostToMain.parse(readyMessage())).toEqual({ type: "host.ready" });
  });

  it("rejects and logs invalid messages without answering", () => {
    const { handler, posted, logs } = setup();
    for (const bad of [
      null,
      { type: "fs.read", path: "C:\\" },
      { ...request(1, "test.echo", { text: "hi" }), origin: "ui" }, // only the agent makes calls
      { type: "host.query", id: id(2), origin: "agent", query: { kind: "audit.list" } }, // only the UI queries
    ]) {
      handler.handle(bad);
    }
    expect(posted).toEqual([]);
    expect(logs.filter((l) => l.message.includes("rejected invalid message"))).toHaveLength(4);
  });

  it("round-trips a call through a permission ask and answers with the result", async () => {
    const { handler, posted } = setup();
    handler.handle(request(1, "test.echo", { text: "hi" }));
    await settle();
    const ask = posted[0];
    expect(ask).toMatchObject({ type: "permission.ask", id: id(100), ask: { kind: "grant", capability: "test.echo" } });
    expect(HostToMain.safeParse(ask).success).toBe(true);

    handler.handle({ type: "permission.answer", id: id(100), decision: { decision: "allow", lifetime: "session" } });
    await settle();
    expect(posted[1]).toEqual({
      type: "capability.result",
      id: id(1),
      result: { ok: true, output: { text: "hi" }, untrusted: false },
    });
    expect(handler.openAsks).toBe(0);
  });

  it("ignores answers to asks it never sent, or already settled", async () => {
    const { handler, posted, logs } = setup();
    handler.handle({ type: "permission.answer", id: id(999), decision: { decision: "approve" } });
    handler.handle(request(1, "test.echo", { text: "hi" }));
    await settle();
    handler.handle({ type: "permission.answer", id: id(100), decision: { decision: "deny" } });
    handler.handle({ type: "permission.answer", id: id(100), decision: { decision: "allow", lifetime: "always" } });
    await settle();
    expect(posted[1]).toMatchObject({ type: "capability.result", result: { ok: false, code: "not_granted" } });
    expect(logs.filter((l) => l.message.includes("unknown or finished ask"))).toHaveLength(2);
  });

  it("treats a never-answered ask as a timeout after the backstop", async () => {
    vi.useFakeTimers();
    try {
      const { handler, posted } = setup({ askBackstopMs: 1000 });
      handler.handle(request(1, "test.echo", { text: "hi" }));
      await vi.advanceTimersByTimeAsync(1001);
      expect(posted[1]).toMatchObject({ type: "capability.result", result: { ok: false, code: "not_granted" } });
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers audit, undo and grant queries", async () => {
    const { handler, posted, grants, db } = setup();
    grants.add({ capability: "test.note", scope: NOTES_APP, lifetime: "always" });
    handler.handle(request(1, "test.note", { text: "milk" }));
    await settle();
    const entryId = (posted[0] as { result: { ok: boolean } }).result.ok ? 1 : -1;

    const query = (n: number, q: unknown) => handler.handle({ type: "host.query", id: id(n), origin: "ui", query: q });
    query(2, { kind: "audit.list" });
    query(3, { kind: "grants.list" });
    await settle();
    expect(posted[1]).toMatchObject({ type: "host.reply", id: id(2), reply: { kind: "audit.list", entries: [{ id: entryId }] } });
    expect(posted[2]).toMatchObject({ reply: { kind: "grants.list", grants: [{ capability: "test.note" }] } });

    query(4, { kind: "audit.undo", entryId });
    await settle();
    expect(posted[3]).toMatchObject({ reply: { kind: "audit.undo", result: { ok: true } } });
    expect(db.prepare("select count(*) as n from test_notes").get()?.["n"]).toBe(0);

    query(5, { kind: "grants.revoke", capability: "test.note", scope: NOTES_APP });
    await settle();
    expect(posted[4]).toMatchObject({ reply: { kind: "grants.revoke" } });
    expect(grants.list()).toEqual([]);

    for (const message of posted) expect(HostToMain.safeParse(message).success).toBe(true);
  });
});

describe("toWire", () => {
  it("fixes codes and texts the wire schema would reject", () => {
    expect(toWire({ ok: false, code: "Bad Code", message: "" })).toEqual({
      ok: false,
      code: "invalid_code",
      message: "The capability failed without saying why.",
    });
    const long = toWire({ ok: false, code: "x", message: "m".repeat(20_000), hint: "h".repeat(20_000) });
    expect(HostToMain.safeParse({ type: "capability.result", id: id(1), result: long }).success).toBe(true);
  });
});
