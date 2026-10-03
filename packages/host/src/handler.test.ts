import { HostToMain, type Log } from "@totum/shared";
import { describe, expect, it, vi } from "vitest";
import { handleMessage, readyMessage } from "./handler.js";

describe("host handler", () => {
  it("announces readiness with a valid host.ready", () => {
    expect(HostToMain.parse(readyMessage())).toEqual({ type: "host.ready" });
  });

  it("rejects and logs any message, since it accepts none yet", () => {
    const log = vi.fn<Log>();
    expect(handleMessage({ type: "capability.request" }, log)).toBeUndefined();
    expect(log).toHaveBeenCalledWith("warn", expect.stringContaining("rejected"));
  });
});
