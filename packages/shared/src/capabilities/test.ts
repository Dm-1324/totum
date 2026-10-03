// Test capabilities, one per tier, that exercise the permission spine
// (milestone 2). They touch only Totum's own database. Dev and test builds
// only: see capabilities/index.ts.
import { z } from "zod";
import type { CapabilitySpec } from "../capability.js";
import { MessageText } from "../ipc/common.js";

export const TestEchoInput = z.object({ text: MessageText }).strict();
export type TestEchoInput = z.infer<typeof TestEchoInput>;
export const TestEchoOutput = z.object({ text: MessageText }).strict();
export type TestEchoOutput = z.infer<typeof TestEchoOutput>;

export const testEchoSpec: CapabilitySpec<TestEchoInput, TestEchoOutput> = {
  id: "test.echo",
  tier: 0,
  description:
    "Test only. Returns the text you send, unchanged. Use to check that a granted tier-0 call works. " +
    'Example input: {"text":"hello"}',
  input: TestEchoInput,
  output: TestEchoOutput,
};

export const TestNoteInput = z.object({ text: MessageText }).strict();
export type TestNoteInput = z.infer<typeof TestNoteInput>;
export const TestNoteOutput = z.object({ noteId: z.number().int().positive() }).strict();
export type TestNoteOutput = z.infer<typeof TestNoteOutput>;

export const testNoteSpec: CapabilitySpec<TestNoteInput, TestNoteOutput> = {
  id: "test.note",
  tier: 1,
  description:
    "Test only. Saves a short note in Totum's test notebook and returns its id. Undoable. " +
    'Example input: {"text":"buy milk"}',
  input: TestNoteInput,
  output: TestNoteOutput,
};

export const TestDangerInput = z.object({}).strict();
export type TestDangerInput = z.infer<typeof TestDangerInput>;
export const TestDangerOutput = z.object({ cleared: z.number().int().nonnegative() }).strict();
export type TestDangerOutput = z.infer<typeof TestDangerOutput>;

export const testDangerSpec: CapabilitySpec<TestDangerInput, TestDangerOutput> = {
  id: "test.danger",
  tier: 2,
  description:
    "Test only. Deletes every note in Totum's test notebook and returns how many. Cannot be undone; " +
    "the user approves each call. Example input: {}",
  input: TestDangerInput,
  output: TestDangerOutput,
};

export const TestSendInput = z
  .object({ to: z.string().min(3).max(254).regex(/^[^\s@]+@[^\s@]+$/), body: MessageText })
  .strict();
export type TestSendInput = z.infer<typeof TestSendInput>;
export const TestSendOutput = z.object({ queued: z.literal(true) }).strict();
export type TestSendOutput = z.infer<typeof TestSendOutput>;

export const testSendSpec: CapabilitySpec<TestSendInput, TestSendOutput> = {
  id: "test.send",
  tier: 3,
  description:
    "Test only. Pretends to send a message to an address (it goes to a local outbox; nothing leaves " +
    'the machine). The user approves each call. Example input: {"to":"a@example.com","body":"hi"}',
  input: TestSendInput,
  output: TestSendOutput,
};
