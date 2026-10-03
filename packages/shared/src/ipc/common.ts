import { z } from "zod";

/** Longest message text accepted at any process boundary, in UTF-16 code units. */
export const MAX_TEXT_LENGTH = 10_000;

/** User or agent text crossing a boundary: non-empty and capped. */
export const MessageText = z.string().min(1).max(MAX_TEXT_LENGTH);

/** Correlates an agent reply with the message that caused it. */
export const MessageId = z.uuid();

/** Summarizes why a payload failed validation, without echoing the payload. */
export function describeIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.code} at ${i.path.join(".") || "(root)"}`);
}
