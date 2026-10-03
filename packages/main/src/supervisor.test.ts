import type { Log } from "@totum/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeChild } from "./fake-child.js";
import { Supervisor, type SupervisorOptions } from "./supervisor.js";

function setup(overrides: Partial<SupervisorOptions> = {}) {
  const children: FakeChild[] = [];
  const log = vi.fn<Log>();
  const onMessage = vi.fn<(m: unknown) => void>();
  const onUp = vi.fn<() => void>();
  const onDown = vi.fn<(reason: string, willRestart: boolean) => void>();
  const sup = new Supervisor({
    name: "agent",
    spawn: () => {
      const c = new FakeChild();
      children.push(c);
      return c;
    },
    log,
    onMessage,
    onUp,
    onDown,
    restartDelayMs: () => 100,
    ...overrides,
  });
  const latest = () => children[children.length - 1]!;
  return { sup, children, latest, log, onMessage, onUp, onDown };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("Supervisor: lifecycle", () => {
  it("is running once the child spawns, and forwards messages both ways", () => {
    const { sup, latest, onUp, onMessage } = setup();
    sup.start();
    expect(sup.state).toBe("starting");
    expect(sup.post("too early")).toBe(false);

    latest().emitSpawn();
    expect(sup.state).toBe("running");
    expect(onUp).toHaveBeenCalledOnce();

    expect(sup.post("hi")).toBe(true);
    expect(latest().posted).toEqual(["hi"]);
    latest().emitMessage("from child");
    expect(onMessage).toHaveBeenCalledWith("from child");
  });
});

describe("Supervisor: the child dies", () => {
  it("notices, logs, reports it down and restarts it", async () => {
    const { sup, children, latest, log, onDown, onUp } = setup();
    sup.start();
    latest().emitSpawn();

    latest().emitExit(3);
    expect(sup.state).toBe("restarting");
    expect(onDown).toHaveBeenCalledWith(expect.stringContaining("stopped unexpectedly"), true);
    expect(log).toHaveBeenCalledWith("error", "main: agent exited unexpectedly with code 3; restarting in 100 ms");
    expect(sup.post("while down")).toBe(false);

    await vi.advanceTimersByTimeAsync(100);
    expect(children).toHaveLength(2);
    latest().emitSpawn();
    expect(sup.state).toBe("running");
    expect(onUp).toHaveBeenCalledTimes(2);
  });

  it("ignores messages and exits from a replaced child", async () => {
    const { sup, children, latest, onMessage } = setup();
    sup.start();
    const old = latest();
    old.emitSpawn();
    old.emitExit(1);
    await vi.advanceTimersByTimeAsync(100);
    latest().emitSpawn();

    old.emitMessage("stale");
    old.emitExit(1);
    expect(onMessage).not.toHaveBeenCalled();
    expect(sup.state).toBe("running");
    expect(children).toHaveLength(2);
  });

  it("gives up after maxRestarts crashes within the window and reports it down", async () => {
    const { sup, children, latest, log, onDown } = setup({ maxRestarts: 3 });
    sup.start();
    for (let i = 0; i < 3; i++) {
      latest().emitExit(1);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(children).toHaveLength(4);
    latest().emitExit(1);
    expect(sup.state).toBe("down");
    expect(onDown).toHaveBeenLastCalledWith("The agent stopped and couldn't be restarted. Restart Totum.", false);
    expect(log).toHaveBeenLastCalledWith("error", expect.stringContaining("giving up"));

    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(4);
  });

  it("keeps restarting when crashes are spread beyond the window", async () => {
    let now = 0;
    const { sup, children, latest } = setup({ maxRestarts: 2, restartWindowMs: 1_000, now: () => now });
    sup.start();
    for (let i = 0; i < 5; i++) {
      now += 2_000;
      latest().emitExit(1);
      await vi.advanceTimersByTimeAsync(100);
    }
    expect(children).toHaveLength(6);
    expect(sup.state).toBe("starting");
  });

  it("treats a spawn that throws like a crash", async () => {
    let fail = true;
    const children: FakeChild[] = [];
    const { sup, log } = setup({
      spawn: () => {
        if (fail) {
          fail = false;
          throw new Error("bad path");
        }
        const c = new FakeChild();
        children.push(c);
        return c;
      },
    });
    sup.start();
    expect(sup.state).toBe("restarting");
    expect(log).toHaveBeenCalledWith("error", "main: failed to start agent", { error: "Error: bad path" });
    await vi.advanceTimersByTimeAsync(100);
    expect(children).toHaveLength(1);
  });
});

describe("Supervisor: stop leaves no process behind", () => {
  it("kills the child, waits for it to exit, and does not restart it", async () => {
    const { sup, children, latest, onDown } = setup();
    sup.start();
    latest().emitSpawn();

    await sup.stop();
    expect(latest().killed).toBe(true);
    expect(sup.state).toBe("stopped");
    expect(onDown).toHaveBeenLastCalledWith("The agent was stopped.", false);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
  });

  it("cancels a pending restart", async () => {
    const { sup, children, latest } = setup();
    sup.start();
    latest().emitExit(1);
    await sup.stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(children).toHaveLength(1);
    expect(sup.state).toBe("stopped");
  });

  it("gives up waiting after stopTimeoutMs if the child ignores kill, and logs it", async () => {
    const { sup, latest, log } = setup({ stopTimeoutMs: 500 });
    sup.start();
    latest().exitOnKill = false;
    const stopping = sup.stop();
    await vi.advanceTimersByTimeAsync(500);
    await stopping;
    expect(sup.state).toBe("stopped");
    expect(log).toHaveBeenCalledWith("error", "main: agent did not exit within 500 ms of kill");
  });

  it("is safe to call twice; both calls wait for the exit", async () => {
    const { sup, latest } = setup();
    sup.start();
    latest().emitSpawn();
    expect(sup.stop()).toBe(sup.stop());
    await sup.stop();
    expect(sup.state).toBe("stopped");
  });
});
