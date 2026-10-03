import type { ChatSendReply } from "./ipc/chat.js";

/**
 * What the preload exposes to the renderer as `window.totum`. One named,
 * typed function per action; never a generic send(channel, data).
 */
export interface TotumApi {
  sendMessage(text: string): Promise<ChatSendReply>;
}
