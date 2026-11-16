import { z } from "zod";
import { AuditEntry, CapabilityId, ErrorCode, Grant, Scope } from "../capability.js";
import { AgentCall, CapabilityCall, PermissionAsk, PermissionDecision } from "../permission.js";
import { MessageId, MessageText } from "./common.js";

// Capability calls travel agent -> main -> host and back (relayed by main,
// which uses its own ids toward host). Permission asks travel host -> main ->
// ui and back; the agent never sees them. See docs/plans/m2.md slice 4.

/** A capability result as it crosses a process boundary. */
export const CapabilityResult = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), output: z.unknown(), untrusted: z.boolean() }).strict(),
  z
    .object({ ok: z.literal(false), code: ErrorCode, message: MessageText, hint: MessageText.optional(), untrusted: z.boolean().optional() })
    .strict(),
]);
export type CapabilityResult = z.infer<typeof CapabilityResult>;

// Route: agent -> main. The agent's only way to ask for anything on the machine.
export const AgentCapabilityRequest = z
  .object({ type: z.literal("capability.request"), id: MessageId, call: AgentCall })
  .strict();
export type AgentCapabilityRequest = z.infer<typeof AgentCapabilityRequest>;

/** Why a call was refused before host could see it. Host records one audit row per refusal. */
export const RefusalCode = z.enum(["no_task", "invalid_request"]);
export type RefusalCode = z.infer<typeof RefusalCode>;

// Route: agent -> main. A call the agent refused to send (it didn't match AgentCall).
// Only so the audit log shows it; the agent already told its caller. `capability` is
// whatever the caller wrote: untrusted text, cut short.
export const AgentCapabilityRefused = z
  .object({
    type: z.literal("capability.refused"),
    capability: z.string().max(80),
    issues: z.array(z.string().max(200)).max(10),
  })
  .strict();
export type AgentCapabilityRefused = z.infer<typeof AgentCapabilityRefused>;

// Route: main -> agent, answering an AgentCapabilityRequest by its id.
export const AgentCapabilityResult = z
  .object({ type: z.literal("capability.result"), id: MessageId, result: CapabilityResult })
  .strict();
export type AgentCapabilityResult = z.infer<typeof AgentCapabilityResult>;

// Route: main -> host. Main stamps `origin` and the call's `taskId`; only the agent makes calls.
export const HostCapabilityRequest = z
  .object({ type: z.literal("capability.request"), id: MessageId, origin: z.literal("agent"), call: CapabilityCall })
  .strict();
export type HostCapabilityRequest = z.infer<typeof HostCapabilityRequest>;

// Route: main -> host. Main (or the agent, via main) refused a call before host saw it; host audits it.
export const HostAuditRefusal = z
  .object({
    type: z.literal("audit.refusal"),
    /** The task in flight, or "none" when there was none. */
    taskId: z.string().min(1).max(64),
    capability: z.string().max(80),
    outcome: RefusalCode,
    issues: z.array(z.string().max(200)).max(10),
  })
  .strict();
export type HostAuditRefusal = z.infer<typeof HostAuditRefusal>;

// Route: host -> main, answering a HostCapabilityRequest by its id.
export const HostCapabilityResult = AgentCapabilityResult;
export type HostCapabilityResult = AgentCapabilityResult;

// Route: host -> main. A question for the user; main shows it in the UI.
export const PermissionAskMessage = z
  .object({ type: z.literal("permission.ask"), id: MessageId, ask: PermissionAsk })
  .strict();
export type PermissionAskMessage = z.infer<typeof PermissionAskMessage>;

// Route: main -> host. The user's answer, or `timeout` (no window, expired, closed).
export const PermissionAnswerMessage = z
  .object({ type: z.literal("permission.answer"), id: MessageId, decision: PermissionDecision })
  .strict();
export type PermissionAnswerMessage = z.infer<typeof PermissionAnswerMessage>;

/** What the UI may ask host for (through main). Only the user's window can send these. */
export const HostQuery = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("audit.list") }).strict(),
  z.object({ kind: z.literal("audit.undo"), entryId: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal("grants.list") }).strict(),
  z.object({ kind: z.literal("grants.revoke"), capability: CapabilityId, scope: Scope }).strict(),
]);
export type HostQuery = z.infer<typeof HostQuery>;

export const HostQueryReply = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("audit.list"), entries: z.array(AuditEntry).max(500) }).strict(),
  z.object({ kind: z.literal("audit.undo"), result: CapabilityResult }).strict(),
  z.object({ kind: z.literal("grants.list"), grants: z.array(Grant).max(1000) }).strict(),
  z.object({ kind: z.literal("grants.revoke") }).strict(),
]);
export type HostQueryReply = z.infer<typeof HostQueryReply>;

// Route: main -> host, origin ui. Request/reply by id.
export const HostQueryMessage = z
  .object({ type: z.literal("host.query"), id: MessageId, origin: z.literal("ui"), query: HostQuery })
  .strict();
export type HostQueryMessage = z.infer<typeof HostQueryMessage>;

// Route: host -> main, answering a HostQueryMessage by its id.
export const HostQueryReplyMessage = z
  .object({ type: z.literal("host.reply"), id: MessageId, reply: HostQueryReply })
  .strict();
export type HostQueryReplyMessage = z.infer<typeof HostQueryReplyMessage>;
