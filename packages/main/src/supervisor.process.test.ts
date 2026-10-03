// The supervisor driving real OS processes. Electron's utilityProcess can't run
// under vitest, so Node's fork stands in, adapted to the same Child interface.
import { fork } from "node:child_process";
import { join } from "node:path";
import type { Log } from "@totum/shared";
import { describe, expect, it, vi } from "vitest";
import { Supervisor, type Child } from "./supervisor.js";

const fixture = (name: string) => join(import.meta.dirname, "fixtures", name);

function forkChild(modulePath: string, pids: number[]): Child {
  const proc = fork(modulePath, [], { stdio: "ignore" });
  if (proc.pid !== undefined) pids.push(proc.pid);
  return {
    pid: proc.pid,
    postMessage: (m) => proc.send(m as object),
    kill: () => {
      proc.kill();
    },
    onSpawn: (l) => proc.on("spawn", l),
    onMessage: (l) => proc.on("message", l),
    onExit: (l) => proc.on("exit", (code) => l(code ?? -1)),
  };
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function until(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 20));
  }
}

describe("Supervisor with real processes", () => {
  it("stop() kills a child that ignores SIGTERM, and the process is gone", async () => {
    const pids: number[] = [];
    const sup = new Supervisor({
      name: "agent",
      spawn: () => forkChild(fixture("idle-child.mjs"), pids),
      log: vi.fn<Log>(),
      onMessage: () => {},
    });
    sup.start();
    await until(() => sup.state === "running");
    expect(isAlive(pids[0]!)).toBe(true);

    await sup.stop();
    expect(sup.state).toBe("stopped");
    expect(pids).toHaveLength(1);
    expect(isAlive(pids[0]!)).toBe(false);
  });

  it("restarts a crashing child, gives up, and leaves no process alive", async () => {
    const pids: number[] = [];
    const log = vi.fn<Log>();
    const onDown = vi.fn<(reason: string, willRestart: boolean) => void>();
    const sup = new Supervisor({
      name: "agent",
      spawn: () => forkChild(fixture("crash-child.mjs"), pids),
      log,
      onMessage: () => {},
      onDown,
      maxRestarts: 2,
      restartDelayMs: () => 10,
    });
    sup.start();
    await until(() => sup.state === "down");

    expect(pids).toHaveLength(3);
    expect(log).toHaveBeenCalledWith("error", "main: agent exited unexpectedly with code 3; restarting in 10 ms");
    expect(onDown).toHaveBeenLastCalledWith(expect.stringContaining("couldn't be restarted"), false);
    for (const pid of pids) expect(isAlive(pid)).toBe(false);
  });
});
