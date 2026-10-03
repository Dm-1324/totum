import { AgentToMain, MAX_TEXT_LENGTH, type Log } from "@totum/shared";
import { describe, expect, it, vi } from "vitest";
import { echo, handleMessage } from "./handler.js";

const id = "3f1c2a9e-7b4d-4e2a-9c1f-5a6b7c8d9e0f";

describe("handleMessage", () => {
  it("answers a valid message with a reply carrying the same id", () => {
    const log = vi.fn<Log>();
    const reply = handleMessage({ type: "agent.message", id, text: "hello" }, log);
    expect(reply).toEqual({ type: "agent.reply", id, text: "agent: hello" });
    expect(log).not.toHaveBeenCalled();
  });

  it("drops and logs an invalid message", () => {
    const log = vi.fn<Log>();
    expect(handleMessage({ type: "agent.message", id: "nope", text: "hello" }, log)).toBeUndefined();
    expect(log).toHaveBeenCalledWith("warn", "agent: rejected invalid message", expect.anything());
  });

  it("does not log the rejected payload itself", () => {
    const log = vi.fn<Log>();
    handleMessage({ type: "agent.message", id, text: "secret".repeat(5000) }, log);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("produces a valid reply even for text at the cap", () => {
    const text = "a".repeat(MAX_TEXT_LENGTH);
    const reply = handleMessage({ type: "agent.message", id, text }, vi.fn<Log>());
    expect(AgentToMain.safeParse(reply).success).toBe(true);
  });
});

describe("echo", () => {
  it("caps the reply at MAX_TEXT_LENGTH", () => {
    expect(echo("a".repeat(MAX_TEXT_LENGTH))).toHaveLength(MAX_TEXT_LENGTH);
  });
});
