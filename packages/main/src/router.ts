// Main's relays between processes. Main validates, stamps and forwards; it
// never runs a capability or decides a permission.
import {
  type AgentCapabilityRequest,
  AuditListRequest,
  AuditUndoRequest,
  type AuditListReply,
  type AuditUndoReply,
  describeIssues,
  GrantsListRequest,
  GrantsRevokeRequest,
  type GrantsListReply,
  type GrantsRevokeReply,
  type HostQuery,
  type HostQueryReply,
  type Log,
  PermissionAnswerRequest,
  type PermissionAnswerReply,
  type Schema,
  type UiErrorCode,
} from "@totum/shared";
import type { AgentClient } from "./agent-client.js";
import type { HostClient } from "./host-client.js";
import type { PermissionBroker } from "./permissions.js";
import { isTrustedSender, type SenderInfo, type TrustedRenderer } from "./sender.js";

/**
 * Whether untrusted content (file text, command output, web pages) has
 * reached the agent since its process started. Main sees every result, so it
 * tracks this itself rather than trusting the agent to: an agent steered by
 * injected text would simply stop saying so.
 *
 * The taint belongs to the agent's memory, not to one task: content read while
 * answering one message can steer the next. So once tainted, every call goes
 * to host as `shapedByUntrusted` (approval even with a grant) until the agent
 * process restarts with an empty context. One flag, nothing to evict, so it
 * can't drift back to clean. Milestone 3 can narrow it to "until the
 * conversation is reset" once conversations exist.
 */
export class AgentTaint {
  #tainted = false;

  get tainted(): boolean {
    return this.#tainted;
  }

  mark(): void {
    this.#tainted = true;
  }

  /** Only when a fresh agent process (no memory) comes up. */
  reset(): void {
    this.#tainted = false;
  }
}

/**
 * agent -> host. The call gets the task id of the user message the agent is
 * answering; with none, it is refused and host never sees it. Main may raise
 * `shapedByUntrusted` (see AgentTaint) but never clears it.
 */
export function relayCapabilityRequest(
  message: AgentCapabilityRequest,
  deps: {
    agent: Pick<AgentClient, "taskId" | "postResult">;
    host: Pick<HostClient, "call">;
    taint: AgentTaint;
    log: Log;
  },
): void {
  const { agent, host, taint, log } = deps;
  const taskId = agent.taskId();
  if (taskId === undefined) {
    log("warn", "main: refused a capability request outside a user request", { id: message.id });
    agent.postResult(message.id, {
      ok: false,
      code: "no_task",
      message: "Capabilities can only be used while answering a request from the user.",
      hint: "Wait for the user to ask for something.",
    });
    return;
  }
  const shapedByUntrusted = message.call.shapedByUntrusted || taint.tainted;
  void host.call({ ...message.call, taskId, shapedByUntrusted }).then((result) => {
    // Mark before the agent can see the content and act on it.
    if (result.untrusted) taint.mark();
    if (!agent.postResult(message.id, result)) {
      log("warn", "main: agent gone before its capability result arrived", { id: message.id });
    }
  });
}

export interface UiDeps {
  trusted: () => TrustedRenderer | undefined;
  broker: Pick<PermissionBroker, "answer">;
  host: Pick<HostClient, "query">;
  log: Log;
}

type UiError = { ok: false; code: UiErrorCode; message: string };

const MESSAGES: Record<UiErrorCode, string> = {
  untrusted_sender: "Request refused: it didn't come from the Totum window.",
  invalid_request: "That request was malformed.",
  unknown_ask: "That question is no longer open.",
  too_soon: "That answer came too quickly after the question appeared. Read it, then answer again.",
  host_unavailable: "Totum's host isn't available right now. Try again in a moment.",
};
const uiError = (code: UiErrorCode, message = MESSAGES[code]): UiError => ({ ok: false, code, message });

/** Sender check and schema check shared by every ui -> main request. */
function guard<T>(
  channel: string,
  sender: SenderInfo,
  raw: unknown,
  schema: Schema<T>,
  deps: UiDeps,
): { ok: true; data: T } | UiError {
  if (!isTrustedSender(sender, deps.trusted())) {
    deps.log("warn", `main: rejected ${channel} from untrusted sender`, {
      webContentsId: sender.webContentsId,
      isMainFrame: sender.isMainFrame,
    });
    return uiError("untrusted_sender");
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    deps.log("warn", `main: rejected invalid ${channel}`, { issues: describeIssues(parsed.error) });
    return uiError("invalid_request");
  }
  return { ok: true, data: parsed.data };
}

async function ask<K extends HostQuery["kind"]>(
  query: Extract<HostQuery, { kind: K }>,
  deps: UiDeps,
): Promise<{ ok: true; reply: Extract<HostQueryReply, { kind: K }> } | UiError> {
  const outcome = await deps.host.query(query);
  if (!outcome.ok) return uiError("host_unavailable", outcome.message);
  // HostClient already checked the reply kind matches the query.
  return { ok: true, reply: outcome.reply as Extract<HostQueryReply, { kind: K }> };
}

export function handlePermissionAnswer(sender: SenderInfo, raw: unknown, deps: UiDeps): PermissionAnswerReply {
  const checked = guard("permission.answer", sender, raw, PermissionAnswerRequest, deps);
  if (!checked.ok) return checked;
  const error = deps.broker.answer(checked.data.id, checked.data.decision);
  return error ? uiError(error) : { ok: true };
}

export async function handleAuditList(sender: SenderInfo, raw: unknown, deps: UiDeps): Promise<AuditListReply> {
  const checked = guard("audit.list", sender, raw, AuditListRequest, deps);
  if (!checked.ok) return checked;
  const answer = await ask({ kind: "audit.list" }, deps);
  return answer.ok ? { ok: true, entries: answer.reply.entries } : answer;
}

export async function handleAuditUndo(sender: SenderInfo, raw: unknown, deps: UiDeps): Promise<AuditUndoReply> {
  const checked = guard("audit.undo", sender, raw, AuditUndoRequest, deps);
  if (!checked.ok) return checked;
  const answer = await ask({ kind: "audit.undo", entryId: checked.data.entryId }, deps);
  return answer.ok ? { ok: true, result: answer.reply.result } : answer;
}

export async function handleGrantsList(sender: SenderInfo, raw: unknown, deps: UiDeps): Promise<GrantsListReply> {
  const checked = guard("grants.list", sender, raw, GrantsListRequest, deps);
  if (!checked.ok) return checked;
  const answer = await ask({ kind: "grants.list" }, deps);
  return answer.ok ? { ok: true, grants: answer.reply.grants } : answer;
}

export async function handleGrantsRevoke(sender: SenderInfo, raw: unknown, deps: UiDeps): Promise<GrantsRevokeReply> {
  const checked = guard("grants.revoke", sender, raw, GrantsRevokeRequest, deps);
  if (!checked.ok) return checked;
  const answer = await ask({ kind: "grants.revoke", ...checked.data }, deps);
  return answer.ok ? { ok: true } : answer;
}
