import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { isAllowedAgentRequest } from "./agent-request.js";

const agentDir = join("C:", "Totum", "out", "agent");
const file = (...parts: string[]) => pathToFileURL(join(...parts)).href;

describe("isAllowedAgentRequest", () => {
  it("allows the agent's own files", () => {
    expect(isAllowedAgentRequest(file(agentDir, "index.html"), agentDir)).toBe(true);
    expect(isAllowedAgentRequest(file(agentDir, "agent.js"), agentDir)).toBe(true);
  });

  it("compares paths case-insensitively (Windows)", () => {
    expect(isAllowedAgentRequest(file("c:", "totum", "OUT", "Agent", "agent.js"), agentDir)).toBe(true);
  });

  it.each([
    ["http", "http://127.0.0.1:5173/"],
    ["https", "https://api.example.com/v1/messages"],
    ["ws", "ws://localhost:8080/"],
    ["data", "data:text/plain,hi"],
    ["blob", "blob:null/1234"],
    ["devtools", "devtools://devtools/bundled/inspector.html"],
    ["a sibling folder", file("C:", "Totum", "out", "agent-preload", "agent.cjs")],
    ["a folder sharing the prefix", file("C:", "Totum", "out", "agent2", "x.js")],
    ["the parent folder", file("C:", "Totum", "out", "renderer", "index.html")],
    ["a path escaping with ..", "file:///C:/Totum/out/agent/../../package.json"],
    ["a UNC share", "file://server/share/out/agent/agent.js"],
    ["garbage", "not a url"],
  ])("blocks %s", (_name, url) => {
    expect(isAllowedAgentRequest(url, agentDir)).toBe(false);
  });
});
