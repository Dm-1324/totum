// @totum/agent: agent loop, model adapter, context, memory. Never touches the OS.
// Runs in a hidden, sandboxed renderer (ADR 0004): no Node, no electron, no
// network beyond what the page CSP and session filter allow. Main talks to it
// over one MessagePort, handed in by the agent preload.
import { AGENT_PORT_CHANNEL, type Log } from "@totum/shared";
import { runDevCall } from "./dev-call.js";
import { createAgent } from "./handler.js";

/** Vite `define`: true in dev builds, false in production (agent.vite.config.ts). */
declare const __TOTUM_DEV__: boolean;

// Console output is forwarded to main's log (console-message event).
const log: Log = (level, message, data) => console[level](data ? `${message} ${JSON.stringify(data)}` : message);

let port: MessagePort | undefined;

window.addEventListener("message", (event) => {
  // Accept exactly one port, from the preload in this window.
  if (port || event.source !== window || event.data !== AGENT_PORT_CHANNEL) return;
  const received = event.ports[0];
  if (!received) return;
  port = received;
  const agent = createAgent({
    post: (message) => received.postMessage(message),
    log,
    command: __TOTUM_DEV__ ? runDevCall : undefined,
  });
  received.onmessage = (message) => agent.receive(message.data);
});
