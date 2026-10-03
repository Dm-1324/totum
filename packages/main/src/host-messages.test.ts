import type { Log } from "@totum/shared";
import { describe, expect, it, vi } from "vitest";
import { handleHostMessage } from "./host-messages.js";

describe("handleHostMessage", () => {
  it("logs host.ready", () => {
    const log = vi.fn<Log>();
    handleHostMessage({ type: "host.ready" }, log);
    expect(log).toHaveBeenCalledWith("info", "main: host ready");
  });

  it("drops and logs an invalid message", () => {
    const log = vi.fn<Log>();
    handleHostMessage({ type: "host.ready", extra: true }, log);
    handleHostMessage({ type: "agent.reply" }, log);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledWith("warn", "main: dropped invalid message from host", expect.anything());
  });
});
