import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  AgentMessage,
  AgentReply,
  AgentToMain,
  ChatSendReply,
  ChatSendRequest,
  HostReady,
  HostToMain,
  MainToAgent,
  MAX_TEXT_LENGTH,
} from "./index.js";

const id = "3f1c2a9e-7b4d-4e2a-9c1f-5a6b7c8d9e0f";

// Every schema with a valid sample. Each one gets the unknown-field test.
const schemas: Array<[string, z.ZodType, Record<string, unknown>]> = [
  ["ChatSendRequest", ChatSendRequest, { text: "hello" }],
  ["ChatSendReply", ChatSendReply, { text: "hello" }],
  ["AgentMessage", AgentMessage, { type: "agent.message", id, text: "hello" }],
  ["AgentReply", AgentReply, { type: "agent.reply", id, text: "hello" }],
  ["HostReady", HostReady, { type: "host.ready" }],
  ["MainToAgent", MainToAgent, { type: "agent.message", id, text: "hello" }],
  ["AgentToMain", AgentToMain, { type: "agent.reply", id, text: "hello" }],
  ["HostToMain", HostToMain, { type: "host.ready" }],
];

// The schemas carrying user or agent text. Each one gets the length tests.
const textSchemas = schemas.filter(([, , sample]) => "text" in sample);

describe.each(schemas)("%s", (_name, schema, sample) => {
  it("accepts a valid payload unchanged", () => {
    expect(schema.parse(sample)).toEqual(sample);
  });

  it("rejects an unknown field", () => {
    const result = schema.safeParse({ ...sample, extra: "x" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("unrecognized_keys");
  });

  it("rejects non-objects", () => {
    for (const bad of [null, undefined, "hello", 42, []]) {
      expect(schema.safeParse(bad).success).toBe(false);
    }
  });
});

describe.each(textSchemas)("%s text", (_name, schema, sample) => {
  it(`accepts text of exactly ${MAX_TEXT_LENGTH} characters`, () => {
    const text = "a".repeat(MAX_TEXT_LENGTH);
    expect(schema.safeParse({ ...sample, text }).success).toBe(true);
  });

  it("rejects text over the cap", () => {
    const result = schema.safeParse({ ...sample, text: "a".repeat(MAX_TEXT_LENGTH + 1) });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.code).toBe("too_big");
  });

  it("rejects a very large payload", () => {
    const result = schema.safeParse({ ...sample, text: "a".repeat(5_000_000) });
    expect(result.success).toBe(false);
  });

  it("rejects empty text", () => {
    expect(schema.safeParse({ ...sample, text: "" }).success).toBe(false);
  });

  it("rejects text of the wrong type", () => {
    expect(schema.safeParse({ ...sample, text: 42 }).success).toBe(false);
  });

  it("rejects missing text", () => {
    const { text: _omit, ...rest } = sample;
    expect(schema.safeParse(rest).success).toBe(false);
  });
});

describe("message envelopes", () => {
  it("rejects an id that isn't a UUID", () => {
    expect(AgentMessage.safeParse({ type: "agent.message", id: "1", text: "hi" }).success).toBe(false);
  });

  it("rejects a message sent on the wrong route", () => {
    // An agent.reply is not something main sends to the agent, and vice versa.
    expect(MainToAgent.safeParse({ type: "agent.reply", id, text: "hi" }).success).toBe(false);
    expect(AgentToMain.safeParse({ type: "agent.message", id, text: "hi" }).success).toBe(false);
    expect(HostToMain.safeParse({ type: "agent.reply", id, text: "hi" }).success).toBe(false);
  });

  it("rejects an unknown message type", () => {
    expect(MainToAgent.safeParse({ type: "fs.read", id, text: "C:\\" }).success).toBe(false);
  });
});
