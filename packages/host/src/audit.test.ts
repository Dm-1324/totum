import { AuditEntry } from "@totum/shared";
import { describe, expect, it } from "vitest";
import { AuditLog, MAX_AUDIT_INPUT, PENDING } from "./audit.js";
import { openDb } from "./db.js";

const start = {
  taskId: "task-1",
  capability: "test.note",
  tier: 1 as const,
  scope: { kind: "app" as const, app: "totum-test-notes" },
  input: { text: "buy milk" },
};
const fixed = () => new Date("2026-10-03T10:00:00.000Z");

describe("AuditLog", () => {
  it("writes a pending row, then finishes it", () => {
    const log = new AuditLog(openDb(":memory:"), fixed);
    const id = log.begin(start);
    expect(log.list()).toEqual([
      {
        id,
        time: "2026-10-03T10:00:00.000Z",
        taskId: "task-1",
        capability: "test.note",
        tier: 1,
        scope: start.scope,
        input: '{"text":"buy milk"}',
        outcome: PENDING,
        approver: "none",
        untrusted: false,
        undoable: false,
        undone: false,
      },
    ]);

    log.finish(id, { outcome: "ok", approver: "grant", untrusted: false, undo: { noteId: 7 } });
    const [entry] = log.list();
    expect(entry).toMatchObject({ outcome: "ok", approver: "grant", undoable: true });
    expect(log.get(id)?.undoToken).toEqual({ noteId: 7 });
  });

  it("records calls that never got a scope", () => {
    const log = new AuditLog(openDb(":memory:"), fixed);
    log.record(
      { taskId: "t", capability: "nope.nope", tier: null, scope: null, input: { x: 1 } },
      { outcome: "unknown_capability", approver: "none", untrusted: false },
    );
    expect(log.list()[0]).toMatchObject({ capability: "nope.nope", tier: null, scope: null, outcome: "unknown_capability" });
  });

  it("lists newest first, and every row is a valid AuditEntry for the UI", () => {
    const log = new AuditLog(openDb(":memory:"), fixed);
    const ids = [log.begin(start), log.begin(start), log.begin(start)];
    const listed = log.list();
    expect(listed.map((e) => e.id)).toEqual([...ids].reverse());
    for (const entry of listed) expect(AuditEntry.parse(entry)).toEqual(entry);
    expect(log.list(2)).toHaveLength(2);
  });

  it("never exposes the undo token in the list", () => {
    const log = new AuditLog(openDb(":memory:"));
    const id = log.begin(start);
    log.finish(id, { outcome: "ok", approver: "grant", untrusted: false, undo: { noteId: 7 } });
    expect(Object.keys(log.list()[0]!)).not.toContain("undoToken");
  });

  it("marks an entry undone, which makes it no longer undoable", () => {
    const log = new AuditLog(openDb(":memory:"));
    const id = log.begin(start);
    log.finish(id, { outcome: "ok", approver: "grant", untrusted: false, undo: 1 });
    log.markUndone(id);
    expect(log.list()[0]).toMatchObject({ undone: true, undoable: false });
  });

  it("cuts oversized inputs and keeps the row readable", () => {
    const log = new AuditLog(openDb(":memory:"));
    log.begin({ ...start, input: { text: "a".repeat(50_000) } });
    const [entry] = log.list();
    expect(entry!.input.length).toBe(MAX_AUDIT_INPUT);
    expect(entry!.input.endsWith("…[truncated]")).toBe(true);
  });

  it("caps a hostile capability name and task id, and stores a bad code as invalid_code", () => {
    const log = new AuditLog(openDb(":memory:"));
    const id = log.begin({ ...start, capability: "x".repeat(500), taskId: "t".repeat(500) });
    log.finish(id, { outcome: "Not A Code!", approver: "none", untrusted: false });
    const [entry] = log.list();
    expect(entry).toMatchObject({ outcome: "invalid_code" });
    expect(entry!.capability).toHaveLength(64);
    expect(entry!.taskId).toHaveLength(64);
  });

  it("stores inputs it can't serialize as a marker instead of throwing", () => {
    const log = new AuditLog(openDb(":memory:"));
    const cyclic: Record<string, unknown> = {};
    cyclic["self"] = cyclic;
    log.begin({ ...start, input: cyclic });
    expect(log.list()[0]!.input).toBe('"[unserializable input]"');
  });
});

