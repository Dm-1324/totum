import type { HostQuery, Log } from "@totum/shared";
import { describe, expect, it, vi } from "vitest";
import type { QueryOutcome } from "./host-client.js";
import {
  handleAuditList,
  handleAuditUndo,
  handleGrantsList,
  handleGrantsRevoke,
  handlePermissionAnswer,
  relayCapabilityRequest,
  TaskTaint,
  type UiDeps,
} from "./router.js";
import type { SenderInfo, TrustedRenderer } from "./sender.js";

const TRUSTED: TrustedRenderer = { webContentsId: 1, url: "file:///C:/totum/out/renderer/index.html" };
const OURS: SenderInfo = { webContentsId: 1, isMainFrame: true, url: TRUSTED.url };
const strangers: SenderInfo[] = [
  { webContentsId: 2, isMainFrame: true, url: TRUSTED.url },
  { webContentsId: 1, isMainFrame: false, url: TRUSTED.url },
  { webContentsId: 1, isMainFrame: true, url: "https://evil.example/" },
  { webContentsId: 1, isMainFrame: true, url: undefined },
];
const askId = "00000000-0000-4000-8000-000000000001";

function deps(outcome?: QueryOutcome) {
  const queries: HostQuery[] = [];
  const answers: unknown[] = [];
  const d: UiDeps = {
    trusted: () => TRUSTED,
    broker: { answer: (id, decision) => (answers.push([id, decision]), undefined) },
    host: {
      query: async (q) => {
        queries.push(q);
        return outcome ?? { ok: false, message: "no host in this test" };
      },
    },
    log: vi.fn<Log>(),
  };
  return { d, queries, answers };
}

const channels = [
  ["permission.answer", (s: SenderInfo, d: UiDeps) => handlePermissionAnswer(s, { id: askId, decision: { decision: "deny" } }, d)],
  ["audit.list", (s: SenderInfo, d: UiDeps) => handleAuditList(s, {}, d)],
  ["audit.undo", (s: SenderInfo, d: UiDeps) => handleAuditUndo(s, { entryId: 1 }, d)],
  ["grants.list", (s: SenderInfo, d: UiDeps) => handleGrantsList(s, {}, d)],
  ["grants.revoke", (s: SenderInfo, d: UiDeps) => handleGrantsRevoke(s, { capability: "test.echo", scope: { kind: "app", app: "x" } }, d)],
] as const;

describe.each(channels)("%s", (_name, handle) => {
  it("refuses every sender but the Totum window's main frame, without reaching broker or host", async () => {
    for (const sender of strangers) {
      const { d, queries, answers } = deps();
      expect(await handle(sender, d)).toMatchObject({ ok: false, code: "untrusted_sender" });
      expect(queries).toEqual([]);
      expect(answers).toEqual([]);
    }
  });
});

describe("ui requests", () => {
  it("refuse malformed payloads", async () => {
    const { d, queries } = deps();
    expect(handlePermissionAnswer(OURS, { id: "x", decision: { decision: "approve" } }, d)).toMatchObject({ code: "invalid_request" });
    expect(handlePermissionAnswer(OURS, { id: askId, decision: { decision: "yes" } }, d)).toMatchObject({ code: "invalid_request" });
    expect(await handleAuditList(OURS, { limit: 1e9 }, d)).toMatchObject({ code: "invalid_request" });
    expect(await handleAuditUndo(OURS, { entryId: -1 }, d)).toMatchObject({ code: "invalid_request" });
    expect(await handleGrantsRevoke(OURS, { capability: "test.echo", scope: { kind: "folder", path: "" } }, d)).toMatchObject({
      code: "invalid_request",
    });
    expect(queries).toEqual([]);
  });

  it("pass valid requests to host and its replies back", async () => {
    const { d, queries } = deps({ ok: true, reply: { kind: "grants.list", grants: [] } });
    expect(await handleGrantsList(OURS, {}, d)).toEqual({ ok: true, grants: [] });
    expect(queries).toEqual([{ kind: "grants.list" }]);
  });

  it("report host trouble as host_unavailable", async () => {
    const { d } = deps({ ok: false, message: "Totum's host didn't answer in time." });
    expect(await handleAuditList(OURS, {}, d)).toEqual({
      ok: false,
      code: "host_unavailable",
      message: "Totum's host didn't answer in time.",
    });
  });
});

describe("relayCapabilityRequest", () => {
  const request = {
    type: "capability.request" as const,
    id: askId,
    call: { capability: "test.echo", input: { text: "hi" }, shapedByUntrusted: false },
  };

  it("stamps the task id of the user message in flight", async () => {
    const calls: unknown[] = [];
    const results: unknown[] = [];
    relayCapabilityRequest(request, {
      agent: { taskId: () => "chat-7", postResult: (id, r) => (results.push([id, r]), true) },
      host: { call: async (c) => (calls.push(c), { ok: true, output: 1, untrusted: false }) },
      taint: new TaskTaint(),
      log: vi.fn<Log>(),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(calls).toEqual([{ ...request.call, taskId: "chat-7" }]);
    expect(results).toEqual([[askId, { ok: true, output: 1, untrusted: false }]]);
  });

  it("once untrusted content reaches the agent, flags every later call in that task, and never clears the flag", async () => {
    const calls: Array<{ taskId: string; shapedByUntrusted: boolean }> = [];
    let task = "chat-1";
    let untrusted = true;
    const deps = {
      agent: { taskId: () => task, postResult: () => true },
      host: {
        call: async (c: { taskId: string; shapedByUntrusted: boolean }) => {
          calls.push({ taskId: c.taskId, shapedByUntrusted: c.shapedByUntrusted });
          return { ok: true as const, output: "file text", untrusted };
        },
      },
      taint: new TaskTaint(),
      log: vi.fn<Log>(),
    };
    const flush = async () => {
      for (let i = 0; i < 3; i++) await Promise.resolve();
    };
    relayCapabilityRequest(request, deps); // reads untrusted content
    await flush();
    untrusted = false;
    relayCapabilityRequest(request, deps); // the agent says false; main says true
    await flush();
    task = "chat-2";
    relayCapabilityRequest(request, deps); // a new user request starts clean
    await flush();
    relayCapabilityRequest({ ...request, call: { ...request.call, shapedByUntrusted: true } }, deps);
    await flush();
    expect(calls).toEqual([
      { taskId: "chat-1", shapedByUntrusted: false },
      { taskId: "chat-1", shapedByUntrusted: true },
      { taskId: "chat-2", shapedByUntrusted: false },
      { taskId: "chat-2", shapedByUntrusted: true },
    ]);
  });
});
