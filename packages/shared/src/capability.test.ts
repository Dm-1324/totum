import { describe, expect, it } from "vitest";
import { AuditEntry, CapabilityId, ErrorCode, Grant, Scope, Tier } from "./capability.js";

const entry = {
  id: 1,
  time: "2026-10-03T10:00:00.000Z",
  taskId: "task-1",
  capability: "test.danger",
  tier: 2,
  scope: { kind: "app", app: "totum-test-notes" },
  input: "{}",
  outcome: "ok",
  approver: "user",
  untrusted: false,
  undoable: false,
  undone: false,
};

describe("Tier", () => {
  it("accepts 0 to 3 only", () => {
    for (const tier of [0, 1, 2, 3]) expect(Tier.safeParse(tier).success).toBe(true);
    for (const bad of [-1, 4, 1.5, "2", null]) expect(Tier.safeParse(bad).success).toBe(false);
  });
});

describe("CapabilityId", () => {
  it("accepts area.verb ids", () => {
    for (const id of ["files.search", "test.echo", "email.draft", "files.contentSearch"]) {
      expect(CapabilityId.safeParse(id).success, id).toBe(true);
    }
  });

  it("rejects anything else", () => {
    for (const bad of ["files", ".read", "files.", "Files.read", "files read", "files/read", "a".repeat(65) + ".x"]) {
      expect(CapabilityId.safeParse(bad).success, bad).toBe(false);
    }
  });
});

describe("Scope", () => {
  it("accepts each kind with its own field", () => {
    for (const scope of [
      { kind: "folder", path: "C:\\Users\\me\\Documents" },
      { kind: "app", app: "totum-test" },
      { kind: "account", account: "me@example.com" },
    ]) {
      expect(Scope.parse(scope)).toEqual(scope);
    }
  });

  it("rejects mixed fields, unknown kinds, empty and oversized values", () => {
    for (const bad of [
      { kind: "folder", app: "x" },
      { kind: "folder", path: "C:\\", extra: 1 },
      { kind: "site", site: "example.com" },
      { kind: "folder", path: "" },
      { kind: "folder", path: "a".repeat(1025) },
    ]) {
      expect(Scope.safeParse(bad).success).toBe(false);
    }
  });
});

describe("Grant", () => {
  const grant = { capability: "test.echo", scope: { kind: "app", app: "totum-test" }, lifetime: "session" };

  it("accepts session and always", () => {
    expect(Grant.parse(grant)).toEqual(grant);
    expect(Grant.safeParse({ ...grant, lifetime: "always" }).success).toBe(true);
  });

  it("rejects task lifetime (milestone 3) and unknown fields", () => {
    expect(Grant.safeParse({ ...grant, lifetime: "task" }).success).toBe(false);
    expect(Grant.safeParse({ ...grant, extra: 1 }).success).toBe(false);
  });
});

describe("ErrorCode", () => {
  it("accepts snake_case codes only", () => {
    expect(ErrorCode.safeParse("not_granted").success).toBe(true);
    for (const bad of ["Not granted", "not-granted", "", "_x"]) expect(ErrorCode.safeParse(bad).success).toBe(false);
  });
});

describe("AuditEntry", () => {
  it("accepts a full entry unchanged", () => {
    expect(AuditEntry.parse(entry)).toEqual(entry);
  });

  it("accepts a call that failed before its scope or tier was known", () => {
    const early = { ...entry, capability: "nope.nope", tier: null, scope: null, outcome: "unknown_capability" };
    expect(AuditEntry.safeParse({ ...early, approver: "none" }).success).toBe(true);
  });

  it("rejects unknown fields, bad approvers and oversized input", () => {
    expect(AuditEntry.safeParse({ ...entry, extra: 1 }).success).toBe(false);
    expect(AuditEntry.safeParse({ ...entry, approver: "agent" }).success).toBe(false);
    expect(AuditEntry.safeParse({ ...entry, input: "a".repeat(20_001) }).success).toBe(false);
  });
});
