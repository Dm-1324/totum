import type { HostToMain, Log } from "@totum/shared";

/** Sent once when the host process is up. */
export function readyMessage(): HostToMain {
  return { type: "host.ready" };
}

/**
 * Handle one message from main. Main sends the host nothing yet (capability
 * requests arrive in milestone 2), so every message is rejected and logged.
 */
export function handleMessage(_raw: unknown, log: Log): undefined {
  log("warn", "host: rejected message; host accepts no messages yet");
  return undefined;
}
