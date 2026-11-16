import { z } from "zod";
import { AuditEntry, CapabilityId, Grant, Scope } from "../capability.js";
import { PermissionAsk, PermissionDecision } from "../permission.js";
import { CapabilityResult } from "./capability.js";
import { MessageId, MessageText } from "./common.js";

// Route: main <-> ui through the preload bridge. Channel names in constants.ts.

// main -> ui event: show this question. `id` is main's; answer with it.
export const UiPermissionAsk = z.object({ id: MessageId, ask: PermissionAsk }).strict();
export type UiPermissionAsk = z.infer<typeof UiPermissionAsk>;

// main -> ui event: that question is over (answered elsewhere, expired, host restarted).
export const UiPermissionClosed = z.object({ id: MessageId }).strict();
export type UiPermissionClosed = z.infer<typeof UiPermissionClosed>;

// ui -> main requests.
export const PermissionAnswerRequest = z.object({ id: MessageId, decision: PermissionDecision }).strict();
export type PermissionAnswerRequest = z.infer<typeof PermissionAnswerRequest>;
export const AuditListRequest = z.object({}).strict();
export const AuditUndoRequest = z.object({ entryId: z.number().int().positive() }).strict();
export type AuditUndoRequest = z.infer<typeof AuditUndoRequest>;
export const GrantsListRequest = z.object({}).strict();
export const GrantsRevokeRequest = z.object({ capability: CapabilityId, scope: Scope }).strict();
export type GrantsRevokeRequest = z.infer<typeof GrantsRevokeRequest>;

/** Why a ui -> main request (other than chat.send) failed. */
export const UiErrorCode = z.enum(["invalid_request", "untrusted_sender", "unknown_ask", "too_soon", "host_unavailable"]);
export type UiErrorCode = z.infer<typeof UiErrorCode>;
const UiError = z.object({ ok: z.literal(false), code: UiErrorCode, message: MessageText }).strict();

/** Each request always resolves with ok + data, or an error the UI can show. */
function reply<T extends z.ZodRawShape>(shape: T) {
  return z.discriminatedUnion("ok", [z.object({ ok: z.literal(true), ...shape }).strict(), UiError]);
}

export const PermissionAnswerReply = reply({});
export type PermissionAnswerReply = z.infer<typeof PermissionAnswerReply>;
export const AuditListReply = reply({ entries: z.array(AuditEntry).max(500) });
export type AuditListReply = z.infer<typeof AuditListReply>;
export const AuditUndoReply = reply({ result: CapabilityResult });
export type AuditUndoReply = z.infer<typeof AuditUndoReply>;
export const GrantsListReply = reply({ grants: z.array(Grant).max(1000) });
export type GrantsListReply = z.infer<typeof GrantsListReply>;
export const GrantsRevokeReply = reply({});
export type GrantsRevokeReply = z.infer<typeof GrantsRevokeReply>;
