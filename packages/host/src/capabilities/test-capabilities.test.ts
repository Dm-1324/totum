// The add-capability skill's required tests for each test capability, all
// through the engine's public call path (never `run` directly).
import { describe, expect, it } from "vitest";
import {
  allowAlways,
  allowSession,
  approve,
  call,
  deny,
  makeEngine,
  scriptedUser,
  settle,
} from "../engine.fixture.js";
import { NOTES_APP, OUTBOX_ACCOUNT, TEST_APP } from "./test-capabilities.js";

const count = (f: ReturnType<typeof makeEngine>, table: "test_notes" | "test_outbox") =>
  f.db.prepare(`select count(*) as n from ${table}`).get()?.["n"];

const cases = [
  { id: "test.echo", input: { text: "hi" }, scope: TEST_APP, tier: 0 },
  { id: "test.note", input: { text: "buy milk" }, scope: NOTES_APP, tier: 1 },
  { id: "test.danger", input: {}, scope: NOTES_APP, tier: 2 },
  { id: "test.send", input: { to: "a@example.com", body: "hi" }, scope: OUTBOX_ACCOUNT, tier: 3 },
] as const;

describe.each(cases)("$id (tier $tier)", ({ id, input, scope, tier }) => {
  const needsApproval = tier >= 2;

  it("without a grant, fails with not_granted and a hint", async () => {
    const f = makeEngine();
    const result = await f.engine.call(call(id, input), scriptedUser([deny]).ask);
    expect(result).toMatchObject({ ok: false, code: "not_granted", hint: expect.any(String) });
  });

  it("a grant for a different scope doesn't count", async () => {
    const f = makeEngine();
    f.grants.add({ capability: id, scope: { kind: "app", app: "something-else" }, lifetime: "session" });
    const user = scriptedUser([deny]);
    const result = await f.engine.call(call(id, input), user.ask);
    expect(result).toMatchObject({ ok: false, code: "not_granted" });
    expect(user.asks[0]).toMatchObject({ kind: "grant", scope });
  });

  it("a grant for a different capability doesn't count", async () => {
    const f = makeEngine();
    f.grants.add({ capability: id === "test.echo" ? "test.note" : "test.echo", scope, lifetime: "session" });
    const result = await f.engine.call(call(id, input), scriptedUser([deny]).ask);
    expect(result).toMatchObject({ ok: false, code: "not_granted" });
  });

  it("writes an audit entry with capability, scope, input, result and approver", async () => {
    const f = makeEngine();
    const user = scriptedUser(needsApproval ? [allowSession, approve] : [allowSession]);
    const result = await f.engine.call(call(id, input, { taskId: "task-audit" }), user.ask);
    expect(result.ok).toBe(true);
    expect(f.audit.list()).toEqual([
      expect.objectContaining({
        taskId: "task-audit",
        capability: id,
        tier,
        scope,
        input: JSON.stringify(input),
        outcome: "ok",
        approver: "user",
        untrusted: id === "test.echo",
        undoable: tier === 1,
      }),
    ]);
  });

  if (!needsApproval) {
    it("runs on an existing grant without asking, approver grant", async () => {
      const f = makeEngine();
      f.grants.add({ capability: id, scope, lifetime: "always" });
      const user = scriptedUser([]);
      const result = await f.engine.call(call(id, input), user.ask);
      expect(result.ok).toBe(true);
      expect(user.asks).toEqual([]);
      expect(f.audit.list()[0]).toMatchObject({ approver: "grant" });
    });
  }

  if (needsApproval) {
    it("blocks until approved, then runs", async () => {
      const f = makeEngine();
      f.grants.add({ capability: id, scope, lifetime: "session" });
      const user = scriptedUser();
      let done = false;
      const pending = f.engine.call(call(id, input), user.ask).then((r) => {
        done = true;
        return r;
      });
      await settle();
      expect(user.pending.map((p) => p.ask.kind)).toEqual(["approval"]);
      await settle();
      expect(done).toBe(false);
      expect(f.audit.list()[0]).toMatchObject({ outcome: "pending" });

      user.pending[0]!.answer(approve);
      expect(await pending).toMatchObject({ ok: true });
      expect(f.audit.list()[0]).toMatchObject({ outcome: "ok", approver: "user" });
    });

    it("rejecting means nothing runs", async () => {
      const f = makeEngine();
      f.db.prepare("insert into test_notes (text) values ('keep me')").run();
      f.grants.add({ capability: id, scope, lifetime: "session" });
      const result = await f.engine.call(call(id, input), scriptedUser([deny]).ask);
      expect(result).toMatchObject({ ok: false, code: "rejected", hint: expect.any(String) });
      expect(count(f, "test_notes")).toBe(1);
      expect(count(f, "test_outbox")).toBe(0);
      expect(f.audit.list()[0]).toMatchObject({ outcome: "rejected", approver: "none" });
    });

    it("an always grant can't skip approval (it isn't even offered)", async () => {
      const f = makeEngine();
      const user = scriptedUser([allowAlways]);
      await f.engine.call(call(id, input), user.ask);
      expect(f.grants.list()).toEqual([]);
    });
  }
});

describe("test.echo", () => {
  it("returns the text unchanged, marked untrusted", async () => {
    const f = makeEngine();
    const result = await f.engine.call(call("test.echo", { text: "héllo <b>x</b>" }), scriptedUser([allowSession]).ask);
    expect(result).toEqual({ ok: true, output: { text: "héllo <b>x</b>" }, untrusted: true });
  });
});

describe("test.note", () => {
  async function saved() {
    const f = makeEngine();
    const result = await f.engine.call(call("test.note", { text: "buy milk" }), scriptedUser([allowSession]).ask);
    const entryId = f.audit.list()[0]!.id;
    return { f, result, entryId };
  }

  it("saves the note and verifies it", async () => {
    const { f, result } = await saved();
    expect(result).toMatchObject({ ok: true, output: { noteId: expect.any(Number) } });
    expect(f.db.prepare("select text from test_notes").all()).toEqual([{ text: "buy milk" }]);
  });

  it("undo removes the note, logs the undo and marks the entry undone", async () => {
    const { f, entryId } = await saved();
    expect(await f.engine.undo(entryId)).toEqual({ ok: true, output: null, untrusted: false });
    expect(count(f, "test_notes")).toBe(0);
    const [undoRow, original] = f.audit.list();
    expect(undoRow).toMatchObject({ capability: "test.note", input: `{"undoOf":${entryId}}`, outcome: "ok", approver: "user" });
    expect(original).toMatchObject({ id: entryId, undone: true, undoable: false });
  });

  it("undo twice is refused", async () => {
    const { f, entryId } = await saved();
    await f.engine.undo(entryId);
    expect(await f.engine.undo(entryId)).toMatchObject({ ok: false, code: "not_undoable" });
  });

  it("undo refuses when the note changed since", async () => {
    const { f, entryId } = await saved();
    f.db.prepare("update test_notes set text = 'edited by hand'").run();
    expect(await f.engine.undo(entryId)).toMatchObject({ ok: false, code: "changed_since" });
    expect(count(f, "test_notes")).toBe(1);
    expect(f.audit.list()[1]).toMatchObject({ undone: false, undoable: true });
  });

  it("undo refuses entries that changed nothing", async () => {
    const f = makeEngine();
    await f.engine.call(call("test.echo", { text: "x" }), scriptedUser([allowSession]).ask);
    expect(await f.engine.undo(f.audit.list()[0]!.id)).toMatchObject({ ok: false, code: "not_undoable" });
    expect(await f.engine.undo(9999)).toMatchObject({ ok: false, code: "not_undoable" });
  });
});

describe("test.danger", () => {
  it("clears every note, verifies, and says how many in the approval", async () => {
    const f = makeEngine();
    f.db.exec("insert into test_notes (text) values ('a'), ('b')");
    const user = scriptedUser([allowSession, approve]);
    const result = await f.engine.call(call("test.danger", {}), user.ask);
    expect(result).toEqual({ ok: true, output: { cleared: 2 }, untrusted: false });
    expect(count(f, "test_notes")).toBe(0);
    expect(user.asks[1]).toMatchObject({ kind: "approval", action: expect.stringContaining("Delete all 2 notes") });
  });
});

describe("test.send", () => {
  it("queues the message locally and verifies it; the approval shows recipient and content", async () => {
    const f = makeEngine();
    const user = scriptedUser([allowSession, approve]);
    const result = await f.engine.call(call("test.send", { to: "a@example.com", body: "Lunch at 1?" }), user.ask);
    expect(result).toEqual({ ok: true, output: { queued: true }, untrusted: false });
    expect(f.db.prepare("select recipient, body from test_outbox").all()).toEqual([
      { recipient: "a@example.com", body: "Lunch at 1?" },
    ]);
    const approval = user.asks[1];
    expect(approval).toMatchObject({ kind: "approval", tier: 3 });
    expect(approval?.kind === "approval" && approval.action).toMatch(/totum-test-outbox.*a@example\.com.*Lunch at 1\?/);
  });
});
