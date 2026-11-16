import { z } from "zod";
import { AgentCapabilityRefused, AgentCapabilityRequest, AgentCapabilityResult } from "./capability.js";
import { MessageId, MessageText } from "./common.js";

// Route: main <-> agent over the utility process port. One-way events;
// a reply carries the id of the message it answers.

export const AgentMessage = z
  .object({ type: z.literal("agent.message"), id: MessageId, text: MessageText })
  .strict();
export type AgentMessage = z.infer<typeof AgentMessage>;

export const AgentReply = z
  .object({ type: z.literal("agent.reply"), id: MessageId, text: MessageText })
  .strict();
export type AgentReply = z.infer<typeof AgentReply>;

/** Everything main may send the agent. */
export const MainToAgent = z.discriminatedUnion("type", [AgentMessage, AgentCapabilityResult]);
export type MainToAgent = z.infer<typeof MainToAgent>;

/** Everything the agent may send main. */
export const AgentToMain = z.discriminatedUnion("type", [AgentReply, AgentCapabilityRequest, AgentCapabilityRefused]);
export type AgentToMain = z.infer<typeof AgentToMain>;
