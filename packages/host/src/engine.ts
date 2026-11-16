// The permission engine: the one path from a capability call to `run`.
// validate -> scope -> grant (ask if missing) -> approval (tier 2/3 or
// untrusted-shaped) -> pending audit row -> run -> verify -> finish the row.
// See .claude/rules/host.md and ADR 0005 for the rules enforced here.
import {
  type Capability,
  type CapabilityCall,
  describeIssues,
  type GrantLifetime,
  type Log,
  MAX_ACTION_LENGTH,
  type PermissionAsk,
  type PermissionDecision,
  type Result,
  type Scope,
  type StopSignal,
  type UndoToken,
} from "@totum/shared";
import type { AuditLog } from "./audit.js";
import { canonicalScope, type GrantStore, normalizeFolder, type PathProbe } from "./grants.js";

/**
 * A capability of any input/output type, as the registry holds it. The input
 * type is erased to `never`; the capability's own schema restores it.
 */
export type AnyCapability = Capability<never, unknown>;

/**
 * Registers a typed capability. The one place its types are erased: safe
 * because the engine passes `run` and friends only input that the capability's
 * own `input` schema produced, and checks outputs against its `output` schema.
 */
export function erase<I, O>(capability: Capability<I, O>): AnyCapability {
  return capability as unknown as AnyCapability;
}

/** Asks the user (host -> main -> ui) and resolves with their decision. Never rejects. */
export type Ask = (ask: PermissionAsk) => Promise<PermissionDecision>;

/** Grant prompts allowed per task before the engine stops asking. */
export const MAX_GRANT_PROMPTS_PER_TASK = 3;
/** Approvals the user may reject (or leave unanswered) in one task before the task is stopped. */
export const MAX_REJECTED_APPROVALS_PER_TASK = 3;
/** Tasks whose denials and prompt counts are remembered (oldest forgotten first). */
const MAX_TRACKED_TASKS = 100;
const MAX_SUMMARY = 10_000;

export interface EngineOptions {
  capabilities: readonly AnyCapability[];
  grants: GrantStore;
  audit: AuditLog;
  log: Log;
  /** Resolves links in a folder scope before its grant check (node:fs in production). */
  fs: PathProbe;
}

interface TaskState {
  denied: Set<string>;
  prompts: number;
  /** Approvals rejected or timed out; at the limit, the task makes no more calls. */
  rejections: number;
}

type Failure = Extract<Result<unknown>, { ok: false }>;

const fail = (code: string, message: string, hint?: string): Failure =>
  hint === undefined ? { ok: false, code, message } : { ok: false, code, message, hint };

const never: StopSignal = { aborted: false, addEventListener: () => {} };

function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case "folder":
      return `folder:${normalizeFolder(scope.path) ?? scope.path}`;
    case "app":
      return `app:${scope.app.toLowerCase()}`;
    case "account":
      return `account:${scope.account.toLowerCase()}`;
  }
}

function scopeText(scope: Scope): string {
  switch (scope.kind) {
    case "folder":
      return `the folder ${scope.path}`;
    case "app":
      return `the app ${scope.app}`;
    case "account":
      return `the account ${scope.account}`;
  }
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + "…" : text);

export class PermissionEngine {
  private readonly capabilities: ReadonlyMap<string, AnyCapability>;
  private readonly tasks = new Map<string, TaskState>();

  constructor(private readonly options: EngineOptions) {
    const map = new Map<string, AnyCapability>();
    for (const capability of options.capabilities) {
      if (map.has(capability.id)) throw new Error(`capability ${capability.id} registered twice`);
      if (capability.tier === 1 && !capability.undo) throw new Error(`tier-1 capability ${capability.id} has no undo`);
      map.set(capability.id, capability);
    }
    this.capabilities = map;
  }

  /** Ids this host can run, for the agent's capability list. */
  ids(): string[] {
    return [...this.capabilities.keys()];
  }

  /** Runs one call through every check. Always resolves; never throws. */
  async call(call: CapabilityCall, ask: Ask, signal: StopSignal = never): Promise<Result<unknown>> {
    const { audit, grants, log } = this.options;
    const capability = this.capabilities.get(call.capability);
    if (!capability) {
      audit.record(
        // Input for a capability we don't know is unchecked: don't store it.
        { taskId: call.taskId, capability: call.capability, tier: null, scope: null, input: { omitted: true } },
        { outcome: "unknown_capability", approver: "none", untrusted: false },
      );
      return fail(
        "unknown_capability",
        `There is no capability called ${call.capability}.`,
        `Use one of: ${this.ids().join(", ") || "(none)"}.`,
      );
    }

    const parsed = capability.input.safeParse(call.input);
    if (!parsed.success) {
      const issues = describeIssues(parsed.error);
      // Unparsed input may hold anything, including secrets: log the problems, not the input.
      audit.record(
        { taskId: call.taskId, capability: capability.id, tier: capability.tier, scope: null, input: { invalid: issues } },
        { outcome: "invalid_input", approver: "none", untrusted: false },
      );
      return fail("invalid_input", `The input for ${capability.id} is not valid: ${issues.join("; ")}.`, capability.description);
    }
    const input = parsed.data;

    let scope: Scope | undefined;
    let action: string;
    let redacted: unknown;
    try {
      scope = canonicalScope(capability.scopeOf(input), this.options.fs);
      // Never shortened: the user must see everything that will run.
      action = capability.describe(input);
      redacted = capability.redact ? capability.redact(input) : input;
    } catch (error) {
      log("error", "host: capability failed to describe its call", { capability: capability.id, error: String(error) });
      scope = undefined;
      action = "";
      redacted = { unavailable: true };
    }
    if (!scope || !action) {
      audit.record(
        { taskId: call.taskId, capability: capability.id, tier: capability.tier, scope: null, input: redacted },
        { outcome: "invalid_input", approver: "none", untrusted: false },
      );
      return fail(
        "invalid_input",
        `Totum can't tell exactly what ${capability.id} would touch with this input.`,
        "Use a full path such as C:\\Users\\you\\Documents, without device prefixes, streams or trailing dots.",
      );
    }
    if (action.length > MAX_ACTION_LENGTH) {
      // Approval dialogs show the whole action or nothing; a cut-off one could hide what really runs.
      audit.record(
        { taskId: call.taskId, capability: capability.id, tier: capability.tier, scope, input: redacted },
        { outcome: "too_long_to_show", approver: "none", untrusted: false },
      );
      return fail(
        "too_long_to_show",
        `This ${capability.id} call is too long to show the user in full (over ${MAX_ACTION_LENGTH} characters).`,
        "Split it into smaller steps.",
      );
    }

    const entry = audit.begin({ taskId: call.taskId, capability: capability.id, tier: capability.tier, scope, input: redacted });
    const finish = (result: Result<unknown>, approver: "user" | "grant" | "none", undo?: UndoToken) => {
      audit.finish(entry, {
        outcome: result.ok ? "ok" : result.code,
        approver,
        untrusted: result.untrusted === true,
        undo,
      });
      return result;
    };

    // The user has turned down enough in this task: stop it, and say so.
    if (this.task(call.taskId).rejections >= MAX_REJECTED_APPROVALS_PER_TASK) {
      return finish(
        fail(
          "approval_reject_limit",
          `The user turned down ${MAX_REJECTED_APPROVALS_PER_TASK} approvals in this task, so it is stopped.`,
          "Stop the task. Tell the user you were refused three times and ask what they want instead.",
        ),
        "none",
      );
    }

    let approver: "user" | "grant" = "grant";
    if (!grants.has(capability.id, scope)) {
      const granted = await this.askGrant(capability, scope, call, ask);
      if (!granted.ok) return finish(granted, "none");
      approver = "user";
    }

    if (capability.tier >= 2 || call.shapedByUntrusted) {
      const decision = await ask({
        kind: "approval",
        taskId: call.taskId,
        capability: capability.id,
        tier: capability.tier,
        scope,
        action,
        shapedByUntrusted: call.shapedByUntrusted,
      });
      if (decision.decision !== "approve") this.task(call.taskId).rejections++;
      if (decision.decision === "timeout") {
        return finish(
          fail("approval_timeout", "Nobody answered the approval request.", "Ask the user whether to try again."),
          "none",
        );
      }
      if (decision.decision !== "approve") {
        return finish(
          fail("rejected", `The user rejected: ${action}`, "Don't retry this step. Ask the user what to do instead."),
          "none",
        );
      }
      approver = "user";
    }

    if (signal.aborted) {
      return finish(fail("stopped", "The task was stopped before this ran.", "Don't continue the task."), approver);
    }

    const ctx = { signal, taskId: call.taskId, log };
    let result: Result<unknown>;
    try {
      result = await capability.run(input, ctx);
    } catch (error) {
      log("error", "host: capability threw", { capability: capability.id, error: String(error) });
      return finish(fail("run_failed", `${capability.id} failed unexpectedly.`, "Tell the user; don't retry."), approver);
    }
    // A failure's text comes from the capability, so it may quote outside content: untrusted unless it says otherwise.
    if (!result.ok) return finish({ ...result, untrusted: result.untrusted ?? true }, approver);

    const output = capability.output.safeParse(result.output);
    if (!output.success) {
      log("error", "host: capability returned output that breaks its schema", {
        capability: capability.id,
        issues: describeIssues(output.error),
      });
      return finish(fail("run_failed", `${capability.id} returned something unexpected.`, "Tell the user."), approver);
    }

    const undo = capability.tier === 1 ? result.undo : undefined;
    if (capability.verify) {
      let verified = false;
      try {
        verified = await capability.verify(input, output.data);
      } catch (error) {
        log("error", "host: capability verify threw", { capability: capability.id, error: String(error) });
      }
      if (!verified) {
        // It may have done something: keep the undo token.
        return finish(
          fail("verify_failed", `${capability.id} ran, but Totum couldn't confirm the result.`, "Tell the user what you tried."),
          approver,
          undo,
        );
      }
    }

    const success: Result<unknown> = { ok: true, output: output.data, untrusted: result.untrusted };
    return finish(success, approver, undo);
  }

  /** Undoes a tier-1 call from the audit log. Only the user asks for this (from the UI). */
  async undo(entryId: number): Promise<Result<null>> {
    const { audit, log } = this.options;
    const entry = audit.get(entryId);
    if (!entry || !entry.undoable || entry.undoToken === undefined) {
      return fail("not_undoable", "That log entry can't be undone.", "It may already be undone, or never changed anything.");
    }
    const capability = this.capabilities.get(entry.capability);
    if (!capability?.undo) {
      return fail("not_undoable", `${entry.capability} isn't available to undo.`);
    }

    const row = audit.begin({
      taskId: entry.taskId,
      capability: capability.id,
      tier: capability.tier,
      scope: entry.scope,
      input: { undoOf: entryId },
    });
    let result: Result<null>;
    try {
      result = await capability.undo({ entryId, token: entry.undoToken }, { signal: never, taskId: entry.taskId, log });
    } catch (error) {
      log("error", "host: undo threw", { capability: capability.id, error: String(error) });
      result = fail("undo_failed", `Undoing ${capability.id} failed unexpectedly.`);
    }
    audit.finish(row, { outcome: result.ok ? "ok" : result.code, approver: "user", untrusted: false });
    if (result.ok) audit.markUndone(entryId);
    return result;
  }

  /** Asks the user for a grant, within the task's limits. ok: the grant was given (and stored). */
  private async askGrant(
    capability: AnyCapability,
    scope: Scope,
    call: CapabilityCall,
    ask: Ask,
  ): Promise<{ ok: true } | Failure> {
    const task = this.task(call.taskId);
    const key = `${capability.id} ${scopeKey(scope)}`;
    const where = scopeText(scope);

    if (task.denied.has(key)) {
      return fail(
        "not_granted",
        `The user already declined ${capability.id} on ${where} in this task.`,
        "Don't ask again in this task. Tell the user what you needed and why.",
      );
    }
    if (task.prompts >= MAX_GRANT_PROMPTS_PER_TASK) {
      return fail(
        "grant_prompt_limit",
        `Totum already asked for ${MAX_GRANT_PROMPTS_PER_TASK} permissions in this task.`,
        "Stop here and tell the user which permissions you still need.",
      );
    }
    task.prompts++;

    const lifetimes: GrantLifetime[] =
      capability.tier <= 1 && !call.shapedByUntrusted ? ["session", "always"] : ["session"];
    const decision = await ask({
      kind: "grant",
      taskId: call.taskId,
      capability: capability.id,
      tier: capability.tier,
      scope,
      summary: clip(capability.description, MAX_SUMMARY),
      lifetimes,
      shapedByUntrusted: call.shapedByUntrusted,
    });

    if (decision.decision === "allow" && lifetimes.includes(decision.lifetime)) {
      this.options.grants.add({ capability: capability.id, scope, lifetime: decision.lifetime });
      return { ok: true };
    }
    if (decision.decision === "allow") {
      this.options.log("warn", "host: refused a grant lifetime that wasn't offered", {
        capability: capability.id,
        lifetime: decision.lifetime,
      });
    }
    task.denied.add(key);
    return fail(
      "not_granted",
      decision.decision === "timeout"
        ? `Nobody answered the request to let ${capability.id} use ${where}.`
        : `The user didn't allow ${capability.id} to use ${where}.`,
      "Don't ask again in this task. Tell the user what you needed and why.",
    );
  }

  private task(taskId: string): TaskState {
    let state = this.tasks.get(taskId);
    if (!state) {
      state = { denied: new Set(), prompts: 0, rejections: 0 };
      this.tasks.set(taskId, state);
      if (this.tasks.size > MAX_TRACKED_TASKS) {
        const oldest = this.tasks.keys().next().value;
        if (oldest !== undefined) this.tasks.delete(oldest);
      }
    }
    return state;
  }
}
