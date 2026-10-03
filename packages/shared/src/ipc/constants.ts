// Plain constants with no zod import, so the preload and renderer can use
// them without bundling the schemas.

/** Longest message text accepted at any process boundary, in UTF-16 code units. */
export const MAX_TEXT_LENGTH = 10_000;

/** ui -> main request/reply channel; see chat.ts. */
export const CHAT_SEND = "chat.send";
