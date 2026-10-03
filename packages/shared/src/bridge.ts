import type { Scope } from "./capability.js";
import type { ChatSendReply } from "./ipc/chat.js";
import type {
  AuditListReply,
  AuditUndoReply,
  GrantsListReply,
  GrantsRevokeReply,
  PermissionAnswerReply,
} from "./ipc/ui.js";
import type { PermissionDecision } from "./permission.js";

/**
 * What the preload exposes to the renderer as `window.totum`. One named,
 * typed function per action; never a generic send(channel, data).
 * Event payloads arrive unvalidated: the UI parses them with the shared schemas.
 */
export interface TotumApi {
  sendMessage(text: string): Promise<ChatSendReply>;
  /** Calls `listener` for each permission question from host. Returns an unsubscribe function. */
  onPermissionAsk(listener: (payload: unknown) => void): () => void;
  /** Calls `listener` when a question is over without this window answering it. */
  onPermissionClosed(listener: (payload: unknown) => void): () => void;
  answerPermission(id: string, decision: PermissionDecision): Promise<PermissionAnswerReply>;
  listAudit(): Promise<AuditListReply>;
  undo(entryId: number): Promise<AuditUndoReply>;
  listGrants(): Promise<GrantsListReply>;
  revokeGrant(capability: string, scope: Scope): Promise<GrantsRevokeReply>;
}
