import type { AgentToMain, Log } from "@totum/shared";
import { describe, expect, it, vi } from "vitest";
import { CapabilityClient } from "./capability-client.js";

function setup() {
  const posted: AgentToMain[] = [];
  const log = vi.fn<Log>();
  let n = 0;
  const client = new CapabilityClient({
    post: (m) => posted.push(m),
    log,
    known: new Set(["test.echo"]),
    newId: () => `00000000-0000-4000-8000-00000000000${++n}`,
  });
  return { client, posted, log };
}

const echo = (text: string) => ({ capability: "test.echo", input: { text }, shapedByUntrusted: false });

describe("CapabilityClient", () => {
  it("matches results to requests by id, in any order", async () => {
    const { client, posted } = setup();
    const a = client.request(echo("a"));
    const b = client.request(echo("b"));
    expect(posted.map((m) => m.id)).toEqual(["00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"]);
    client.receive({ type: "capability.result", id: posted[1]!.id, result: { ok: true, output: "B", untrusted: false } });
    client.receive({ type: "capability.result", id: posted[0]!.id, result: { ok: true, output: "A", untrusted: false } });
    expect(await a).toMatchObject({ output: "A" });
    expect(await b).toMatchObject({ output: "B" });
    expect(client.pendingCount).toBe(0);
  });

  it("ignores a second result for the same id", async () => {
    const { client, posted, log } = setup();
    const done = client.request(echo("a"));
    const id = posted[0]!.id;
    client.receive({ type: "capability.result", id, result: { ok: true, output: 1, untrusted: false } });
    client.receive({ type: "capability.result", id, result: { ok: true, output: 2, untrusted: false } });
    expect(await done).toMatchObject({ output: 1 });
    expect(log).toHaveBeenCalledTimes(1);
  });

  it("refuses extra fields such as a task id the agent tries to pick itself", async () => {
    const { client, posted } = setup();
    const call = { ...echo("a"), taskId: "my-own-task" } as unknown as Parameters<CapabilityClient["request"]>[0];
    expect(await client.request(call)).toMatchObject({ ok: false, code: "invalid_request" });
    expect(posted).toEqual([]);
  });

  it("refuses unknown capabilities without sending, naming the known ones", async () => {
    const { client, posted } = setup();
    expect(await client.request({ ...echo("a"), capability: "shell.execute" })).toEqual({
      ok: false,
      code: "unknown_capability",
      message: "There is no capability with that id.",
      hint: "Known: test.echo.",
    });
    expect(posted).toEqual([]);
  });

  it("passes shapedByUntrusted through unchanged", () => {
    const { client, posted } = setup();
    void client.request({ ...echo("a"), shapedByUntrusted: true });
    expect(posted[0]).toMatchObject({ call: { shapedByUntrusted: true } });
  });
});
