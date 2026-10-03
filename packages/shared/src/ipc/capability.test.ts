import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  AgentCapabilityRequest,
  AgentToMain,
  AuditUndoRequest,
  CapabilityResult,
  GrantsRevokeRequest,
  HostQueryMessage,
  HostQueryReplyMessage,
  HostToMain,
  MainToAgent,
  MainToHost,
  PermissionAnswerMessage,
  PermissionAnswerReply,
  PermissionAnswerRequest,
  PermissionAskMessage,
  UiPermissionAsk,
} from "../index.js";

const id = "3f1c2a9e-7b4d-4e2a-9c1f-5a6b7c8d9e0f";
const agentCall = { capability: "test.danger", input: {}, shapedByUntrusted: false };
const call = { ...agentCall, taskId: "task-1" };
const approval = {
  kind: "approval",
  taskId: "task-1",
  capability: "test.danger",
  tier: 2,
  scope: { kind: "app", app: "totum-test-notes" },
  action: "Delete all 2 notes",
  shapedByUntrusted: false,
};
const grant = {
  kind: "grant",
  taskId: "task-1",
  capability: "test.echo",
  tier: 0,
  scope: { kind: "app", app: "totum-test" },
  summary: "Echo.",
  lifetimes: ["session", "always"],
  shapedByUntrusted: false,
};

const samples: Array<[string, z.ZodType, Record<string, unknown>]> = [
  ["AgentCapabilityRequest", AgentCapabilityRequest, { type: "capability.request", id, call: agentCall }],
  ["MainToHost capability.request", MainToHost, { type: "capability.request", id, origin: "agent", call }],
  ["HostToMain capability.result", HostToMain, { type: "capability.result", id, result: { ok: true, output: [1], untrusted: true } }],
  ["MainToAgent capability.result", MainToAgent, { type: "capability.result", id, result: { ok: false, code: "rejected", message: "No." } }],
  ["PermissionAskMessage approval", PermissionAskMessage, { type: "permission.ask", id, ask: approval }],
  ["PermissionAskMessage grant", PermissionAskMessage, { type: "permission.ask", id, ask: grant }],
  ["PermissionAnswerMessage", PermissionAnswerMessage, { type: "permission.answer", id, decision: { decision: "approve" } }],
  ["HostQueryMessage", HostQueryMessage, { type: "host.query", id, origin: "ui", query: { kind: "audit.undo", entryId: 3 } }],
  ["HostQueryReplyMessage", HostQueryReplyMessage, { type: "host.reply", id, reply: { kind: "grants.revoke" } }],
  ["UiPermissionAsk", UiPermissionAsk, { id, ask: approval }],
  ["PermissionAnswerRequest", PermissionAnswerRequest, { id, decision: { decision: "allow", lifetime: "session" } }],
  ["AuditUndoRequest", AuditUndoRequest, { entryId: 1 }],
  ["GrantsRevokeRequest", GrantsRevokeRequest, { capability: "test.echo", scope: { kind: "app", app: "x" } }],
  ["PermissionAnswerReply", PermissionAnswerReply, { ok: true }],
];

describe.each(samples)("%s", (_name, schema, sample) => {
  it("accepts a valid payload unchanged", () => {
    expect(schema.parse(sample)).toEqual(sample);
  });

  it("rejects an unknown field", () => {
    expect(schema.safeParse({ ...sample, extra: "x" }).success).toBe(false);
  });
});

describe("capability routes", () => {
  it("won't let the agent name its task", () => {
    expect(AgentToMain.safeParse({ type: "capability.request", id, call }).success).toBe(false);
  });

  it("accepts calls to host only with origin agent, and queries only with origin ui", () => {
    expect(MainToHost.safeParse({ type: "capability.request", id, origin: "ui", call }).success).toBe(false);
    expect(MainToHost.safeParse({ type: "host.query", id, origin: "agent", query: { kind: "audit.list" } }).success).toBe(false);
  });

  it("keeps permission messages off the agent's routes", () => {
    expect(AgentToMain.safeParse({ type: "permission.answer", id, decision: { decision: "approve" } }).success).toBe(false);
    expect(MainToAgent.safeParse({ type: "permission.ask", id, ask: approval }).success).toBe(false);
    expect(MainToHost.safeParse({ type: "permission.ask", id, ask: approval }).success).toBe(false);
    expect(HostToMain.safeParse({ type: "permission.answer", id, decision: { decision: "approve" } }).success).toBe(false);
  });

  it("rejects a grant ask without lifetimes, or with an unknown one", () => {
    expect(PermissionAskMessage.safeParse({ type: "permission.ask", id, ask: { ...grant, lifetimes: [] } }).success).toBe(false);
    expect(
      PermissionAskMessage.safeParse({ type: "permission.ask", id, ask: { ...grant, lifetimes: ["forever"] } }).success,
    ).toBe(false);
  });

  it("rejects an approval action over the cap rather than accepting a shortened one", () => {
    const action = "a".repeat(16_001);
    expect(PermissionAskMessage.safeParse({ type: "permission.ask", id, ask: { ...approval, action } }).success).toBe(false);
  });

  it("rejects results that mix the ok and error shapes or carry a bad code", () => {
    expect(CapabilityResult.safeParse({ ok: true, code: "x", message: "y" }).success).toBe(false);
    expect(CapabilityResult.safeParse({ ok: false, output: 1, untrusted: false }).success).toBe(false);
    expect(CapabilityResult.safeParse({ ok: false, code: "Bad Code", message: "y" }).success).toBe(false);
    expect(CapabilityResult.safeParse({ ok: false, code: "x", message: "" }).success).toBe(false);
  });

  it("rejects an undo of a non-positive entry id", () => {
    for (const entryId of [0, -1, 1.5, "1"]) expect(AuditUndoRequest.safeParse({ entryId }).success).toBe(false);
  });
});
