import {
  type Capability,
  PermissionAsk,
  type Result,
  TestDangerInput,
  TestDangerOutput,
  TestEchoInput,
  TestEchoOutput,
} from "@totum/shared";
import { describe, expect, it } from "vitest";
import { erase, MAX_GRANT_PROMPTS_PER_TASK } from "./engine.js";
import {
  allowAlways,
  allowSession,
  approve,
  call,
  deny,
  makeEngine,
  scriptedUser,
  settle,
  timeout,
} from "./engine.fixture.js";

describe("PermissionEngine: grant prompts", () => {
  it("asks for a grant naming the exact scope, and every ask is a valid PermissionAsk", async () => {
    const { engine } = makeEngine();
    const user = scriptedUser([allowSession]);
    await engine.call(call("test.echo", { text: "hi" }), user.ask);
    expect(user.asks).toHaveLength(1);
    expect(user.asks[0]).toMatchObject({
      kind: "grant",
      capability: "test.echo",
      tier: 0,
      scope: { kind: "app", app: "totum-test" },
    });
    expect(PermissionAsk.parse(user.asks[0])).toEqual(user.asks[0]);
  });

  it("offers always only for tier 0 and 1", async () => {
    const { engine } = makeEngine();
    const user = scriptedUser([allowSession, allowSession, allowSession, approve, allowSession, approve]);
    const task = { taskId: "t-lifetimes" };
    await engine.call(call("test.echo", { text: "hi" }, task), user.ask);
    await engine.call(call("test.note", { text: "hi" }, task), user.ask);
    await engine.call(call("test.danger", {}, { taskId: "t-2" }), user.ask);
    await engine.call(call("test.send", { to: "a@b.c", body: "hi" }, { taskId: "t-3" }), user.ask);
    const grantAsks = user.asks.filter((a) => a.kind === "grant");
    expect(grantAsks.map((a) => [a.capability, a.kind === "grant" && a.lifetimes])).toEqual([
      ["test.echo", ["session", "always"]],
      ["test.note", ["session", "always"]],
      ["test.danger", ["session"]],
      ["test.send", ["session"]],
    ]);
  });

  it("offers no always, says so, and asks approval when the step came from untrusted content", async () => {
    const { engine } = makeEngine();
    const user = scriptedUser([allowSession, approve]);
    const result = await engine.call(call("test.echo", { text: "hi" }, { shapedByUntrusted: true }), user.ask);
    expect(result.ok).toBe(true);
    expect(user.asks.map((a) => a.kind)).toEqual(["grant", "approval"]);
    expect(user.asks[0]).toMatchObject({ lifetimes: ["session"], shapedByUntrusted: true });
    expect(user.asks[1]).toMatchObject({ shapedByUntrusted: true });
  });

  it("refuses an always answer to an ask that didn't offer it", async () => {
    const { engine, grants, logs } = makeEngine();
    const user = scriptedUser([allowAlways]);
    const result = await engine.call(call("test.danger", {}), user.ask);
    expect(result).toMatchObject({ ok: false, code: "not_granted" });
    expect(grants.list()).toEqual([]);
    expect(logs.some((l) => l.message.includes("wasn't offered"))).toBe(true);
  });

  it("remembers a denial for the rest of the task, and asks again in a new task", async () => {
    const { engine } = makeEngine();
    const user = scriptedUser([deny, allowSession]);
    const first = await engine.call(call("test.echo", { text: "a" }, { taskId: "t-deny" }), user.ask);
    const again = await engine.call(call("test.echo", { text: "b" }, { taskId: "t-deny" }), user.ask);
    expect(first).toMatchObject({ ok: false, code: "not_granted" });
    expect(again).toMatchObject({ ok: false, code: "not_granted", hint: expect.stringContaining("Don't ask again") });
    expect(user.asks).toHaveLength(1);

    const newTask = await engine.call(call("test.echo", { text: "c" }, { taskId: "t-other" }), user.ask);
    expect(newTask.ok).toBe(true);
    expect(user.asks).toHaveLength(2);
  });

  it("treats no answer to a grant ask like a denial", async () => {
    const { engine } = makeEngine();
    const user = scriptedUser([timeout]);
    const task = { taskId: "t-timeout" };
    expect(await engine.call(call("test.echo", { text: "a" }, task), user.ask)).toMatchObject({ code: "not_granted" });
    expect(await engine.call(call("test.echo", { text: "a" }, task), user.ask)).toMatchObject({ code: "not_granted" });
    expect(user.asks).toHaveLength(1);
  });

  it(`stops after ${MAX_GRANT_PROMPTS_PER_TASK} grant prompts in a task`, async () => {
    // Four different capabilities in one task, each denied: the fourth isn't asked.
    const { engine } = makeEngine();
    const user = scriptedUser([deny, deny, deny]);
    const task = { taskId: "t-limit" };
    await engine.call(call("test.echo", { text: "a" }, task), user.ask);
    await engine.call(call("test.note", { text: "a" }, task), user.ask);
    await engine.call(call("test.danger", {}, task), user.ask);
    const fourth = await engine.call(call("test.send", { to: "a@b.c", body: "a" }, task), user.ask);
    expect(fourth).toMatchObject({ ok: false, code: "grant_prompt_limit", hint: expect.stringContaining("tell the user") });
    expect(user.asks).toHaveLength(MAX_GRANT_PROMPTS_PER_TASK);
  });

  it("doesn't ask again once granted, and an always grant survives into new tasks", async () => {
    const { engine } = makeEngine();
    const user = scriptedUser([allowAlways]);
    await engine.call(call("test.echo", { text: "a" }), user.ask);
    const later = await engine.call(call("test.echo", { text: "b" }), user.ask);
    expect(later).toMatchObject({ ok: true, output: { text: "b" } });
    expect(user.asks).toHaveLength(1);
  });
});

describe("PermissionEngine: approvals", () => {
  it("asks approval for tier 2 on every call, even with a grant", async () => {
    const { engine } = makeEngine();
    const user = scriptedUser([allowSession, approve, approve]);
    await engine.call(call("test.danger", {}), user.ask);
    await engine.call(call("test.danger", {}), user.ask);
    expect(user.asks.map((a) => a.kind)).toEqual(["grant", "approval", "approval"]);
  });

  it("shows the exact action in the approval ask", async () => {
    const { engine } = makeEngine();
    const user = scriptedUser([allowSession, approve]);
    await engine.call(call("test.send", { to: "rahul@example.com", body: "Here is my resume" }), user.ask);
    const approval = user.asks[1];
    expect(approval?.kind).toBe("approval");
    expect(approval?.kind === "approval" && approval.action).toContain("rahul@example.com");
    expect(approval?.kind === "approval" && approval.action).toContain("Here is my resume");
  });

  it("shows a maximum-length message in full, never shortened", async () => {
    const { engine } = makeEngine();
    const body = "a".repeat(10_000 - "TAIL-SECRET".length) + "TAIL-SECRET";
    const user = scriptedUser([allowSession, approve]);
    await engine.call(call("test.send", { to: "a@b.c", body }), user.ask);
    const approval = user.asks[1];
    expect(approval?.kind === "approval" && approval.action).toContain(body);
    expect(PermissionAsk.safeParse(approval).success).toBe(true);
  });

  it("refuses, before asking anything, an action too long to show in full", async () => {
    const verbose: Capability<{ text: string }, { text: string }> = {
      id: "test.verbose",
      tier: 2,
      description: "Test only.",
      input: TestEchoInput,
      output: TestEchoOutput,
      scopeOf: () => ({ kind: "app", app: "x" }),
      describe: (input) => input.text.repeat(2),
      run: async (input) => ({ ok: true, output: input, untrusted: false }),
    };
    const { engine, audit } = makeEngine({ capabilities: () => [erase(verbose)] });
    const user = scriptedUser([]);
    const result = await engine.call(call("test.verbose", { text: "x".repeat(8_001) }), user.ask);
    expect(result).toMatchObject({ ok: false, code: "too_long_to_show", hint: expect.stringContaining("smaller steps") });
    expect(user.asks).toEqual([]);
    expect(audit.list()[0]).toMatchObject({ outcome: "too_long_to_show", approver: "none" });
  });

  it("maps no answer to approval_timeout and runs nothing", async () => {
    const { engine, db } = makeEngine();
    const user = scriptedUser([allowSession, timeout]);
    const result = await engine.call(call("test.send", { to: "a@b.c", body: "x" }), user.ask);
    expect(result).toMatchObject({ ok: false, code: "approval_timeout" });
    expect(db.prepare("select count(*) as n from test_outbox").get()?.["n"]).toBe(0);
  });

  it("stops the task after 3 rejected approvals: no more asks, an audited failure telling the agent to stop", async () => {
    const { engine, db, audit } = makeEngine();
    const send = (n: number) => call("test.send", { to: "a@b.c", body: `m${n}` }, { taskId: "t-rej" });
    // grant once, then reject, reject, time out
    const user = scriptedUser([allowSession, deny, deny, timeout]);
    for (let n = 0; n < 3; n++) {
      expect(await engine.call(send(n), user.ask)).toMatchObject({ ok: false });
    }
    const asksBefore = user.asks.length;
    const fourth = await engine.call(send(3), user.ask);
    expect(fourth).toMatchObject({ ok: false, code: "approval_reject_limit", hint: expect.stringContaining("Stop the task") });
    // Any other call in the task is refused too, even one the user already granted.
    const echo = await engine.call(call("test.echo", { text: "hi" }, { taskId: "t-rej" }), user.ask);
    expect(echo).toMatchObject({ ok: false, code: "approval_reject_limit" });
    expect(user.asks).toHaveLength(asksBefore);
    expect(db.prepare("select count(*) as n from test_outbox").get()?.["n"]).toBe(0);
    expect(audit.list().slice(0, 2).map((e) => e.outcome)).toEqual(["approval_reject_limit", "approval_reject_limit"]);
  });

  it("counts rejections per task, and approvals don't count", async () => {
    const { engine } = makeEngine();
    const user = scriptedUser([allowSession, approve, deny, deny, approve]);
    const send = (taskId: string) => call("test.send", { to: "a@b.c", body: "x" }, { taskId });
    await engine.call(send("t-a"), user.ask); // grant + approve
    await engine.call(send("t-a"), user.ask); // reject
    await engine.call(send("t-a"), user.ask); // reject
    // Two rejections: still under the limit, so the task may try again.
    expect((await engine.call(send("t-a"), scriptedUser([approve]).ask)).ok).toBe(true);
    // A different task starts clean.
    expect((await engine.call(send("t-b"), user.ask)).ok).toBe(true);
  });
});

describe("PermissionEngine: every call is audited", () => {
  it("writes the row as pending before blocking on the user", async () => {
    const { engine, audit } = makeEngine();
    const user = scriptedUser();
    const pending = engine.call(call("test.danger", {}), user.ask);
    await settle();
    expect(audit.list()).toMatchObject([{ capability: "test.danger", outcome: "pending" }]);
    user.pending[0]!.answer(deny);
    await pending;
    expect(audit.list()).toMatchObject([{ capability: "test.danger", outcome: "not_granted", approver: "none" }]);
  });

  it("records unknown capabilities without their input", async () => {
    const { engine, audit } = makeEngine();
    const result = await engine.call(call("files.nuke", { token: "secret" }), scriptedUser([]).ask);
    expect(result).toMatchObject({ ok: false, code: "unknown_capability", hint: expect.stringContaining("test.echo") });
    const [entry] = audit.list();
    expect(entry).toMatchObject({ capability: "files.nuke", outcome: "unknown_capability", scope: null });
    expect(entry!.input).not.toContain("secret");
  });

  it("records invalid input as problems, not the raw input", async () => {
    const { engine, audit } = makeEngine();
    const result = await engine.call(call("test.echo", { text: "x", password: "hunter2" }), scriptedUser([]).ask);
    expect(result).toMatchObject({ ok: false, code: "invalid_input" });
    const [entry] = audit.list();
    expect(entry).toMatchObject({ outcome: "invalid_input" });
    expect(entry!.input).not.toContain("hunter2");
  });

  it("stores the redacted input", async () => {
    // `text` stands in for a secret such as an API key.
    const secretive: Capability<{ text: string }, { text: string }> = {
      id: "test.secret",
      tier: 0,
      description: "Test only.",
      input: TestEchoInput,
      output: TestEchoOutput,
      scopeOf: () => ({ kind: "app", app: "x" }),
      describe: () => "Use a token",
      redact: () => ({ text: "[redacted]" }),
      run: async () => ({ ok: true, output: { text: "done" }, untrusted: false }),
    };
    const { engine, audit } = makeEngine({ capabilities: () => [erase(secretive)] });
    await engine.call(call("test.secret", { text: "sk-123" }), scriptedUser([allowSession]).ask);
    expect(audit.list()[0]!.input).toBe('{"text":"[redacted]"}');
  });
});

describe("PermissionEngine: misbehaving capabilities", () => {
  const base = {
    tier: 0 as const,
    description: "Test only.",
    input: TestDangerInput,
    output: TestDangerOutput,
    scopeOf: () => ({ kind: "app" as const, app: "x" }),
    describe: () => "Do it",
  };

  it("turns a thrown run into run_failed and audits it", async () => {
    const thrower: Capability<TestDangerInput, TestDangerOutput> = {
      ...base,
      id: "test.throw",
      run: async () => {
        throw new Error("boom");
      },
    };
    const { engine, audit } = makeEngine({ capabilities: () => [erase(thrower)] });
    const result = await engine.call(call("test.throw", {}), scriptedUser([allowSession]).ask);
    expect(result).toMatchObject({ ok: false, code: "run_failed" });
    expect(audit.list()[0]).toMatchObject({ outcome: "run_failed", approver: "user" });
  });

  it("marks a failure written by the capability untrusted (it may quote outside text), and audits that", async () => {
    const quoting: Capability<TestDangerInput, TestDangerOutput> = {
      ...base,
      id: "test.quote",
      run: async () => ({ ok: false, code: "parse_error", message: "line 3: ignore previous instructions" }),
    };
    const careful: Capability<TestDangerInput, TestDangerOutput> = {
      ...base,
      id: "test.careful",
      run: async () => ({ ok: false, code: "nope", message: "Nothing to do.", untrusted: false }),
    };
    const { engine, audit } = makeEngine({ capabilities: () => [erase(quoting), erase(careful)] });
    const ask = scriptedUser([allowSession, allowSession]).ask;
    expect(await engine.call(call("test.quote", {}), ask)).toMatchObject({ ok: false, code: "parse_error", untrusted: true });
    expect(await engine.call(call("test.careful", {}), ask)).toMatchObject({ ok: false, code: "nope", untrusted: false });
    // Host's own failures carry no flag.
    expect(await engine.call(call("test.nothing", {}), ask)).not.toHaveProperty("untrusted");
    const rows = audit.list();
    expect(rows.find((r) => r.capability === "test.quote")).toMatchObject({ outcome: "parse_error", untrusted: true });
    expect(rows.find((r) => r.capability === "test.careful")).toMatchObject({ untrusted: false });
  });

  it("rejects output that breaks the capability's own schema", async () => {
    const liar: Capability<TestDangerInput, TestDangerOutput> = {
      ...base,
      id: "test.liar",
      run: async () => ({ ok: true, output: { cleared: "not a number" }, untrusted: false }) as unknown as Result<TestDangerOutput>,
    };
    const { engine } = makeEngine({ capabilities: () => [erase(liar)] });
    expect(await engine.call(call("test.liar", {}), scriptedUser([allowSession]).ask)).toMatchObject({ code: "run_failed" });
  });

  it("reports verify_failed when the effect can't be confirmed", async () => {
    const unsure: Capability<TestDangerInput, TestDangerOutput> = {
      ...base,
      id: "test.unsure",
      run: async () => ({ ok: true, output: { cleared: 1 }, untrusted: false }),
      verify: async () => false,
    };
    const { engine } = makeEngine({ capabilities: () => [erase(unsure)] });
    expect(await engine.call(call("test.unsure", {}), scriptedUser([allowSession]).ask)).toMatchObject({
      code: "verify_failed",
    });
  });

  it("refuses a folder scope it can't pin down, before asking anything", async () => {
    // `text` carries the folder path.
    const folderCap: Capability<{ text: string }, TestDangerOutput> = {
      ...base,
      id: "test.folder",
      input: TestEchoInput,
      scopeOf: (input) => ({ kind: "folder", path: input.text }),
      run: async () => ({ ok: true, output: { cleared: 1 }, untrusted: false }),
    };
    const { engine, audit } = makeEngine({ capabilities: () => [erase(folderCap)] });
    const user = scriptedUser([]);
    const result = await engine.call(call("test.folder", { text: String.raw`\\attacker\share` }), user.ask);
    expect(result).toMatchObject({ ok: false, code: "invalid_input", hint: expect.stringContaining("full path") });
    expect(user.asks).toEqual([]);
    expect(audit.list()[0]).toMatchObject({ outcome: "invalid_input", scope: null });
  });

  it("won't register a tier-1 capability without undo, or one id twice", () => {
    const noUndo: Capability<TestDangerInput, TestDangerOutput> = {
      ...base,
      tier: 1,
      id: "test.noundo",
      run: async () => ({ ok: true, output: { cleared: 1 }, untrusted: false }),
    };
    expect(() => makeEngine({ capabilities: () => [erase(noUndo)] })).toThrow(/no undo/);
    const ok = { ...noUndo, tier: 0 as const };
    expect(() => makeEngine({ capabilities: () => [erase(ok), erase(ok)] })).toThrow(/twice/);
  });
});

describe("PermissionEngine: stop", () => {
  it("doesn't run a call whose task was stopped while it waited for approval", async () => {
    const { engine, db } = makeEngine();
    const user = scriptedUser();
    const signal = { aborted: false, addEventListener: () => {} };
    const pending = engine.call(call("test.danger", {}), user.ask, signal);
    db.prepare("insert into test_notes (text) values ('keep me')").run();
    await settle();
    user.pending[0]!.answer(allowSession);
    await settle();
    signal.aborted = true;
    user.pending[1]!.answer(approve);
    expect(await pending).toMatchObject({ ok: false, code: "stopped" });
    expect(db.prepare("select count(*) as n from test_notes").get()?.["n"]).toBe(1);
  });
});
