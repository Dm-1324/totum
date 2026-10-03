// Preload for the sandboxed renderer. Exposes exactly one named function per
// action as window.totum; never ipcRenderer itself or a generic send.
import { CHAT_SEND, type ChatSendReply, type TotumApi } from "@totum/shared";
import { contextBridge, ipcRenderer } from "electron";

const api: TotumApi = {
  sendMessage: (text: string) => ipcRenderer.invoke(CHAT_SEND, { text }) as Promise<ChatSendReply>,
};

contextBridge.exposeInMainWorld("totum", api);
