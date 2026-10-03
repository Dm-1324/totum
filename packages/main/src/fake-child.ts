import type { Child } from "./supervisor.js";

/** A scriptable Child for tests: emit spawn, message and exit by hand. */
export class FakeChild implements Child {
  readonly pid = 4242;
  readonly posted: unknown[] = [];
  killed = false;
  /** When true, kill() makes the child exit (code 1) on the next tick. */
  exitOnKill = true;
  #spawn: Array<() => void> = [];
  #message: Array<(m: unknown) => void> = [];
  #exit: Array<(code: number) => void> = [];

  postMessage(message: unknown): void {
    this.posted.push(message);
  }
  kill(): void {
    this.killed = true;
    if (this.exitOnKill) queueMicrotask(() => this.emitExit(1));
  }
  onSpawn(listener: () => void): void {
    this.#spawn.push(listener);
  }
  onMessage(listener: (m: unknown) => void): void {
    this.#message.push(listener);
  }
  onExit(listener: (code: number) => void): void {
    this.#exit.push(listener);
  }

  emitSpawn(): void {
    for (const l of this.#spawn) l();
  }
  emitMessage(message: unknown): void {
    for (const l of this.#message) l(message);
  }
  emitExit(code: number): void {
    for (const l of this.#exit) l(code);
  }
}
