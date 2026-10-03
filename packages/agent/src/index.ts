// @totum/agent: agent loop, model adapter, context, memory. Never touches the OS.
// Runs in a hidden, sandboxed renderer (ADR 0004): no Node, no electron, no
// network beyond what the page CSP and session filter allow. Main talks to it
// over one MessagePort, handed in by the agent preload.
import { AGENT_PORT_CHANNEL, type Log } from "@totum/shared";
import { handleMessage } from "./handler.js";

// Console output is forwarded to main's log (console-message event).
const log: Log = (level, message, data) => console[level](data ? `${message} ${JSON.stringify(data)}` : message);

let port: MessagePort | undefined;

window.addEventListener("message", (event) => {
  // Accept exactly one port, from the preload in this window.
  if (port || event.source !== window || event.data !== AGENT_PORT_CHANNEL) return;
  const received = event.ports[0];
  if (!received) return;
  port = received;
  received.onmessage = (message) => {
    const reply = handleMessage(message.data, log);
    if (reply) received.postMessage(reply);
  };
});
