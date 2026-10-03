// Preload for the sandboxed renderer. Exposes exactly one named function per
// action as window.totum; never ipcRenderer itself or a generic send.
import {
  AUDIT_LIST,
  AUDIT_UNDO,
  type AuditListReply,
  type AuditUndoReply,
  CHAT_SEND,
  type ChatSendReply,
  GRANTS_LIST,
  GRANTS_REVOKE,
  type GrantsListReply,
  type GrantsRevokeReply,
  PERMISSION_ANSWER,
  PERMISSION_ASK,
  PERMISSION_CLOSED,
  type PermissionAnswerReply,
  type TotumApi,
} from "@totum/shared";
import { contextBridge, ipcRenderer, type IpcRendererEvent } from "electron";

/** Subscribes to a main -> ui event, handing the page only the payload (never the event or its sender). */
function subscribe(channel: string, listener: (payload: unknown) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, payload: unknown) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: TotumApi = {
  sendMessage: (text) => ipcRenderer.invoke(CHAT_SEND, { text }) as Promise<ChatSendReply>,
  onPermissionAsk: (listener) => subscribe(PERMISSION_ASK, listener),
  onPermissionClosed: (listener) => subscribe(PERMISSION_CLOSED, listener),
  answerPermission: (id, decision) =>
    ipcRenderer.invoke(PERMISSION_ANSWER, { id, decision }) as Promise<PermissionAnswerReply>,
  listAudit: () => ipcRenderer.invoke(AUDIT_LIST, {}) as Promise<AuditListReply>,
  undo: (entryId) => ipcRenderer.invoke(AUDIT_UNDO, { entryId }) as Promise<AuditUndoReply>,
  listGrants: () => ipcRenderer.invoke(GRANTS_LIST, {}) as Promise<GrantsListReply>,
  revokeGrant: (capability, scope) =>
    ipcRenderer.invoke(GRANTS_REVOKE, { capability, scope }) as Promise<GrantsRevokeReply>,
};

contextBridge.exposeInMainWorld("totum", api);
