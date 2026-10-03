import { utilityProcess } from "electron";
import type { Child } from "./supervisor.js";

/** Forks an Electron utility process and adapts it to the supervisor's Child. */
export function forkUtility(modulePath: string, serviceName: string): Child {
  const proc = utilityProcess.fork(modulePath, [], { serviceName, stdio: "inherit" });
  return {
    get pid() {
      return proc.pid;
    },
    postMessage: (message) => proc.postMessage(message),
    kill: () => {
      proc.kill();
    },
    onSpawn: (listener) => proc.on("spawn", listener),
    onMessage: (listener) => proc.on("message", listener),
    onExit: (listener) => proc.on("exit", listener),
  };
}
