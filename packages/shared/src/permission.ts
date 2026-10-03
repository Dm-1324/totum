// A capability call and the questions the host's engine asks the user about it.
// The IPC envelopes that carry these are in ipc/; the engine uses them directly.
import { z } from "zod";
import { CapabilityId, GrantLifetime, Scope, Tier } from "./capability.js";
import { MessageText } from "./ipc/common.js";

/** Identifies a task (in milestone 2: one chat message). Grant denials and prompt limits are per task. */
export const TaskId = z.string().min(1).max(64);

/** One capability call, as the agent asks for it. The input is checked against the capability's own schema by host. */
export const CapabilityCall = z
  .object({
    taskId: TaskId,
    capability: CapabilityId,
    input: z.unknown(),
    /** The step came from untrusted content (a file, a page, command output): ask approval as tier 2+. */
    shapedByUntrusted: z.boolean(),
  })
  .strict();
export type CapabilityCall = z.infer<typeof CapabilityCall>;

/**
 * A call as the agent sends it: no task id. Main adds the id of the user
 * request it is answering, so the agent can't start a fresh "task" to escape
 * per-task denials and prompt limits, or act when the user asked nothing.
 */
export const AgentCall = CapabilityCall.omit({ taskId: true });
export type AgentCall = z.infer<typeof AgentCall>;

/**
 * Longest action an approval dialog shows. Above the longest message text, so
 * a describe() quoting a full message fits. Longer actions are refused, never
 * shortened: the user must see everything that will run.
 */
export const MAX_ACTION_LENGTH = 16_000;

/** Plain words for a dialog: what will run, on what, in full. */
export const AskText = z.string().min(1).max(MAX_ACTION_LENGTH);

/** The host asks the user: may this capability touch this scope (grant), or may this exact call run (approval)? */
export const PermissionAsk = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("grant"),
      taskId: TaskId,
      capability: CapabilityId,
      tier: Tier,
      scope: Scope,
      /** What the capability does, from its spec. */
      summary: MessageText,
      /** Lifetimes the user may pick. Never `always` for tier 2/3 or untrusted-shaped calls. */
      lifetimes: z.array(GrantLifetime).min(1).max(2),
      shapedByUntrusted: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("approval"),
      taskId: TaskId,
      capability: CapabilityId,
      tier: Tier,
      scope: Scope,
      /** `describe(input)`: the exact command, path, recipient or content. */
      action: AskText,
      shapedByUntrusted: z.boolean(),
    })
    .strict(),
]);
export type PermissionAsk = z.infer<typeof PermissionAsk>;

/** The user's answer. `timeout` covers no answer, no window to ask in, and an expired ask. */
export const PermissionDecision = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("allow"), lifetime: GrantLifetime }).strict(),
  z.object({ decision: z.literal("approve") }).strict(),
  z.object({ decision: z.literal("deny") }).strict(),
  z.object({ decision: z.literal("timeout") }).strict(),
]);
export type PermissionDecision = z.infer<typeof PermissionDecision>;
