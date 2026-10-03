import type { Log } from "@totum/shared";

/** A running child process, as the supervisor sees it. */
export interface Child {
  /** OS process id once spawned; for logs. */
  readonly pid: number | undefined;
  postMessage(message: unknown): void;
  kill(): void;
  onSpawn(listener: () => void): void;
  onMessage(listener: (message: unknown) => void): void;
  onExit(listener: (code: number) => void): void;
}

export type SupervisorState = "idle" | "starting" | "running" | "restarting" | "down" | "stopping" | "stopped";

export interface SupervisorOptions {
  /** Shown in logs and user-facing reasons: "agent", "host". */
  name: string;
  spawn: () => Child;
  log: Log;
  onMessage: (message: unknown) => void;
  onUp?: () => void;
  /** The process is gone; `willRestart` is false once the supervisor gives up or stops. */
  onDown?: (reason: string, willRestart: boolean) => void;
  /** Give up after this many restarts within `restartWindowMs`. */
  maxRestarts?: number;
  restartWindowMs?: number;
  restartDelayMs?: (attempt: number) => number;
  /** How long stop() waits for the process to exit after killing it. */
  stopTimeoutMs?: number;
  now?: () => number;
}

/**
 * Keeps one child process alive: notices when it exits, restarts it with
 * backoff, gives up (state "down") after too many crashes, and kills it on stop().
 */
export class Supervisor {
  readonly #o: Required<Omit<SupervisorOptions, "onUp" | "onDown">> & Pick<SupervisorOptions, "onUp" | "onDown">;
  #state: SupervisorState = "idle";
  #child: Child | undefined;
  #restarts: number[] = [];
  #restartTimer: ReturnType<typeof setTimeout> | undefined;
  #exitWaiters: Array<() => void> = [];
  #stopping: Promise<void> | undefined;

  constructor(options: SupervisorOptions) {
    this.#o = {
      maxRestarts: 3,
      restartWindowMs: 60_000,
      restartDelayMs: (attempt) => 250 * 2 ** (attempt - 1),
      stopTimeoutMs: 5_000,
      now: () => Date.now(),
      ...options,
    };
  }

  get state(): SupervisorState {
    return this.#state;
  }

  start(): void {
    if (this.#state !== "idle") throw new Error(`${this.#o.name} supervisor already started`);
    this.#launch();
  }

  /** Posts to the child; false when it isn't running (the caller reports that). */
  post(message: unknown): boolean {
    if (this.#state !== "running" || !this.#child) return false;
    try {
      this.#child.postMessage(message);
      return true;
    } catch (error) {
      this.#o.log("error", `main: posting to ${this.#o.name} failed`, { error: String(error) });
      return false;
    }
  }

  /** Kills the child and waits for it to exit. Never restarts afterwards. */
  stop(): Promise<void> {
    this.#stopping ??= this.#stop();
    return this.#stopping;
  }

  async #stop(): Promise<void> {
    clearTimeout(this.#restartTimer);
    this.#restartTimer = undefined;
    const child = this.#child;
    this.#state = "stopping";
    this.#o.onDown?.(`The ${this.#o.name} was stopped.`, false);

    if (child) {
      const exited = new Promise<"exited">((resolve) => this.#exitWaiters.push(() => resolve("exited")));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = new Promise<"timeout">((resolve) => {
        timer = setTimeout(() => resolve("timeout"), this.#o.stopTimeoutMs);
      });
      child.kill();
      const outcome = await Promise.race([exited, timedOut]);
      clearTimeout(timer);
      if (outcome === "timeout") {
        this.#o.log("error", `main: ${this.#o.name} did not exit within ${this.#o.stopTimeoutMs} ms of kill`);
      }
    }
    this.#child = undefined;
    this.#state = "stopped";
    this.#o.log("info", `main: ${this.#o.name} stopped`);
  }

  #launch(): void {
    this.#state = "starting";
    let child: Child;
    try {
      child = this.#o.spawn();
    } catch (error) {
      this.#o.log("error", `main: failed to start ${this.#o.name}`, { error: String(error) });
      this.#handleExit(-1);
      return;
    }
    this.#child = child;

    child.onSpawn(() => {
      if (this.#child !== child || this.#state !== "starting") return;
      this.#state = "running";
      this.#o.log("info", `main: ${this.#o.name} started`, { pid: child.pid });
      this.#o.onUp?.();
    });
    child.onMessage((message) => {
      if (this.#child === child) this.#o.onMessage(message);
    });
    child.onExit((code) => {
      if (this.#child !== child) return;
      this.#child = undefined;
      for (const resolve of this.#exitWaiters.splice(0)) resolve();
      if (this.#state === "stopping") return; // stop() finishes up
      this.#handleExit(code);
    });
  }

  #handleExit(code: number): void {
    const { name, log } = this.#o;
    const now = this.#o.now();
    this.#restarts = this.#restarts.filter((t) => now - t < this.#o.restartWindowMs);

    if (this.#restarts.length >= this.#o.maxRestarts) {
      this.#state = "down";
      log("error", `main: ${name} exited with code ${code}; restarted ${this.#restarts.length} times recently, giving up`);
      this.#o.onDown?.(`The ${name} stopped and couldn't be restarted. Restart Totum.`, false);
      return;
    }

    this.#restarts.push(now);
    const delay = this.#o.restartDelayMs(this.#restarts.length);
    this.#state = "restarting";
    log("error", `main: ${name} exited unexpectedly with code ${code}; restarting in ${delay} ms`);
    this.#o.onDown?.(`The ${name} stopped unexpectedly and is restarting. Try again in a moment.`, true);
    this.#restartTimer = setTimeout(() => {
      this.#restartTimer = undefined;
      if (this.#state === "restarting") this.#launch();
    }, delay);
  }
}
