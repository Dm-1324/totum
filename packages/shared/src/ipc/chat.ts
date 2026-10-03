import { z } from "zod";
import { MessageText } from "./common.js";

// Route: ui -> main, request/reply, through the preload bridge only.
// The channel name is the message type; payloads carry data only.

export const CHAT_SEND = "chat.send";

export const ChatSendRequest = z.object({ text: MessageText }).strict();
export type ChatSendRequest = z.infer<typeof ChatSendRequest>;

export const ChatSendReply = z.object({ text: MessageText }).strict();
export type ChatSendReply = z.infer<typeof ChatSendReply>;
