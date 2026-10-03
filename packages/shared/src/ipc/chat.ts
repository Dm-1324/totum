import { z } from "zod";
import { MessageText } from "./common.js";


// Route: ui -> main, request/reply, through the preload bridge only.
// The channel name is the message type; payloads carry data only.

export const ChatSendRequest = z.object({ text: MessageText }).strict();
export type ChatSendRequest = z.infer<typeof ChatSendRequest>;

/** Why a chat.send failed. The UI shows `message`; `code` is for logic. */
export const ChatErrorCode = z.enum(["invalid_request", "untrusted_sender", "agent_timeout", "agent_unavailable"]);
export type ChatErrorCode = z.infer<typeof ChatErrorCode>;

/** A chat.send always resolves with one of these; it never throws to the UI. */
export const ChatSendReply = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), text: MessageText }).strict(),
  z.object({ ok: z.literal(false), code: ChatErrorCode, message: MessageText }).strict(),
]);
export type ChatSendReply = z.infer<typeof ChatSendReply>;
