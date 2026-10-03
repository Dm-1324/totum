import { ChatSendRequest, describeIssues, type ChatSendReply, type Log } from "@totum/shared";
import { AgentRequestError, type AgentClient } from "./agent-client.js";
import { isTrustedSender, type SenderInfo, type TrustedRenderer } from "./sender.js";

export interface ChatSendDeps {
  agent: Pick<AgentClient, "send">;
  log: Log;
  /** Our window and page; undefined until the window exists. */
  trusted: () => TrustedRenderer | undefined;
}

/**
 * Handles chat.send from a renderer. Always resolves with a ChatSendReply;
 * the UI never sees a thrown error or a request that never settles.
 */
export async function handleChatSend(sender: SenderInfo, raw: unknown, deps: ChatSendDeps): Promise<ChatSendReply> {
  const { agent, log } = deps;

  if (!isTrustedSender(sender, deps.trusted())) {
    log("warn", "main: rejected chat.send from untrusted sender", {
      webContentsId: sender.webContentsId,
      isMainFrame: sender.isMainFrame,
      urlLength: sender.url?.length ?? 0,
    });
    return {
      ok: false,
      code: "untrusted_sender",
      message: "Request refused: it didn't come from the Totum window.",
    };
  }

  const parsed = ChatSendRequest.safeParse(raw);
  if (!parsed.success) {
    log("warn", "main: rejected invalid chat.send", {
      issues: describeIssues(parsed.error),
    });
    return {
      ok: false,
      code: "invalid_request",
      message: "That message couldn't be sent: it was empty, too long or malformed.",
    };
  }

  try {
    return { ok: true, text: await agent.send(parsed.data.text) };
  } catch (error) {
    if (error instanceof AgentRequestError) {
      return { ok: false, code: error.code, message: error.message };
    }
    log("error", "main: unexpected error in chat.send", { error: String(error) });
    return { ok: false, code: "agent_unavailable", message: "Something went wrong talking to the agent." };
  }
}
