import { type AgentToMain, describeIssues, type Log, MainToAgent, MAX_TEXT_LENGTH } from "@totum/shared";
import { CapabilityClient } from "./capability-client.js";

/** A chat command that may use capabilities: its reply, or undefined if the text isn't one. */
export type Command = (text: string, capabilities: CapabilityClient) => Promise<string> | undefined;

export interface AgentOptions {
  post: (message: AgentToMain) => void;
  log: Log;
  /** Capability ids the agent may request. */
  known: ReadonlySet<string>;
  /** Dev builds only: the `/call` command (index.ts wires it behind __TOTUM_DEV__). */
  command?: Command | undefined;
  newId?: (() => string) | undefined;
}

/**
 * The agent's side of its port to main. Milestone 2 has no model: a user
 * message gets an echo, or (dev builds) the `/call` command's reply. Invalid
 * messages are logged, never answered.
 */
export function createAgent(options: AgentOptions) {
  const { post, log } = options;
  const capabilities = new CapabilityClient({ post, log, known: options.known, newId: options.newId });

  function receive(raw: unknown): void {
    const parsed = MainToAgent.safeParse(raw);
    if (!parsed.success) {
      log("warn", "agent: rejected invalid message", { issues: describeIssues(parsed.error) });
      return;
    }
    const message = parsed.data;
    switch (message.type) {
      case "agent.message": {
        const reply = (text: string) => post({ type: "agent.reply", id: message.id, text: cap(text) });
        const running = options.command?.(message.text, capabilities);
        if (!running) {
          reply(echo(message.text));
          return;
        }
        running.then(reply, () => reply("That command failed inside the agent."));
        return;
      }
      case "capability.result":
        capabilities.receive(message);
        return;
    }
  }

  return { receive, capabilities };
}

/** Milestone 1 has no model: the agent echoes. Capped so the reply stays valid. */
export function echo(text: string): string {
  return cap(`agent: ${text}`);
}

const cap = (text: string) => text.slice(0, MAX_TEXT_LENGTH);
