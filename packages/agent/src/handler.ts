import { describeIssues, MainToAgent, MAX_TEXT_LENGTH, type AgentToMain, type Log } from "@totum/shared";

/**
 * Handle one message from main. Returns the reply to post, or undefined when
 * the message is invalid (logged, never answered).
 */
export function handleMessage(raw: unknown, log: Log): AgentToMain | undefined {
  const parsed = MainToAgent.safeParse(raw);
  if (!parsed.success) {
    log("warn", "agent: rejected invalid message", {
      issues: describeIssues(parsed.error),
    });
    return undefined;
  }

  const message = parsed.data;
  switch (message.type) {
    case "agent.message":
      return { type: "agent.reply", id: message.id, text: echo(message.text) };
  }
}

/** Milestone 1 has no model: the agent echoes. Capped so the reply stays valid. */
export function echo(text: string): string {
  return `agent: ${text}`.slice(0, MAX_TEXT_LENGTH);
}
