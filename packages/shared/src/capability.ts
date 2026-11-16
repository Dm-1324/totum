// The capability contract (docs/architecture.md, ADR 0005). Every capability
// has a spec here in shared (what the model, the engine and the UI see) and an
// implementation in packages/host (the only place `run` and `undo` exist).
import { z } from "zod";
import type { Log } from "./log.js";

/** 0 observe · 1 reversible local · 2 local, hard to undo · 3 leaves the machine. */
export const Tier = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type Tier = z.infer<typeof Tier>;

/** `area.verb`, e.g. `files.search`. */
export const CapabilityId = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/);
export type CapabilityId = z.infer<typeof CapabilityId>;

const ScopeValue = z.string().min(1).max(1024);

/** The one folder, app or account a call touches. Grants are matched on it. */
export const Scope = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("folder"), path: ScopeValue }).strict(),
  z.object({ kind: z.literal("app"), app: ScopeValue }).strict(),
  z.object({ kind: z.literal("account"), account: ScopeValue }).strict(),
]);
export type Scope = z.infer<typeof Scope>;

/** How long a grant lasts. `task` arrives with tasks in milestone 3. */
export const GrantLifetime = z.enum(["session", "always"]);
export type GrantLifetime = z.infer<typeof GrantLifetime>;

export const Grant = z
  .object({ capability: CapabilityId, scope: Scope, lifetime: GrantLifetime })
  .strict();
export type Grant = z.infer<typeof Grant>;

/** Failure codes the engine itself produces. Capabilities add their own. */
export const EngineErrorCode = z.enum([
  "unknown_capability",
  "invalid_input",
  "not_granted",
  "grant_prompt_limit",
  "rejected",
  "approval_timeout",
  "run_failed",
  "verify_failed",
  "too_long_to_show",
  "stopped",
  "not_undoable",
  "undo_failed",
  "host_unavailable",
]);
export type EngineErrorCode = z.infer<typeof EngineErrorCode>;

/** Any failure code: snake_case, stable, safe to branch on. */
export const ErrorCode = z
  .string()
  .max(64)
  .regex(/^[a-z][a-z0-9_]*$/);

/** JSON a capability hands back so its own undo can reverse the call later. */
export type UndoToken = string | number | boolean | null | UndoToken[] | { [key: string]: UndoToken };

export type Result<O> =
  | { ok: true; output: O; untrusted: boolean; undo?: UndoToken }
  | {
      ok: false;
      code: string;
      message: string;
      hint?: string;
      /**
       * The message may quote outside text (file contents, command output, a web page).
       * Left out by a capability, the engine treats its failure as untrusted; set
       * `false` only when the message is written by the capability, never quoting input from outside.
       */
      untrusted?: boolean;
    };

/** The part of AbortSignal we use; shared has no DOM or Node types. */
export interface StopSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
}

export interface RunContext {
  /** Aborted when the task is stopped. */
  signal: StopSignal;
  taskId: string;
  log: Log;
}

/** Who let a call run: the user just now, an existing grant, or nobody (it didn't run). */
export const Approver = z.enum(["user", "grant", "none"]);
export type Approver = z.infer<typeof Approver>;

/** One row of the audit log as the UI sees it. Every call gets one, whatever its outcome. */
export const AuditEntry = z
  .object({
    id: z.number().int().positive(),
    /** ISO 8601. */
    time: z.string().max(40),
    taskId: z.string().max(64),
    capability: z.string().max(64),
    tier: Tier.nullable(),
    /** Null when the call failed before its scope was known (unknown id, bad input). */
    scope: Scope.nullable(),
    /** The input as JSON text, after the capability's `redact`. */
    input: z.string().max(20_000),
    /** `ok` or an error code. */
    outcome: ErrorCode,
    approver: Approver,
    untrusted: z.boolean(),
    undoable: z.boolean(),
    undone: z.boolean(),
  })
  .strict();
export type AuditEntry = z.infer<typeof AuditEntry>;

/**
 * What a tier-1 capability's undo gets back from the call it reverses. Only the
 * token: the stored input is redacted, so undo must not depend on it.
 */
export interface UndoRecord {
  entryId: number;
  token: UndoToken;
}

/** The part of a capability every process may know: the model reads it, the UI shows it. */
export interface CapabilitySpec<I, O> {
  id: CapabilityId;
  /** What the model reads to choose it. Under 400 characters. */
  description: string;
  tier: Tier;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
}

/** A capability as host implements it. Only the host's engine calls these. */
export interface Capability<I, O> extends CapabilitySpec<I, O> {
  scopeOf(input: I): Scope;
  /** Plain words for the approval dialog: the exact command, path, recipient or account. */
  describe(input: I): string;
  run(input: I, ctx: RunContext): Promise<Result<O>>;
  verify?(input: I, output: O): Promise<boolean>;
  /** Required for tier 1. Refuses (ok: false) if the state changed since the call. */
  undo?(record: UndoRecord, ctx: RunContext): Promise<Result<null>>;
  /** Returns the input with secrets removed, for the audit log. Default: the input. */
  redact?(input: I): unknown;
}
