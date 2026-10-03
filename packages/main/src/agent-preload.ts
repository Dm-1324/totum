/// <reference lib="dom" />
// Preload for the hidden agent window (ADR 0004). Its only job: hand the
// MessagePort from main to the agent page. It exposes nothing: no
// contextBridge API, no ipcRenderer, no other channel.
import { AGENT_PORT_CHANNEL } from "@totum/shared";
import { ipcRenderer } from "electron";

ipcRenderer.once(AGENT_PORT_CHANNEL, (event) => {
  const [port] = event.ports;
  if (port) window.postMessage(AGENT_PORT_CHANNEL, "*", [port]);
});
