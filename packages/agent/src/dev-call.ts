// The `/call` chat command (milestone 2, dev and test builds only; removed in
// milestone 3). index.ts references this module only behind __TOTUM_DEV__, so
// production bundles leave it out (checked by production-build.test.ts).
import { type AgentCall, type CapabilityResult, MAX_TEXT_LENGTH } from "@totum/shared";
import type { CapabilityClient } from "./capability-client.js";

export const DEV_CALL_PREFIX = "/call";

const USAGE = 'Usage: /call <capability id> <json input>, e.g. /call test.echo {"text":"hi"}';

/** Splits `/call <id> <json>`. Undefined when the text isn't a /call command at all. */
export function parseDevCall(text: string): { ok: true; call: AgentCall } | { ok: false; message: string } | undefined {
  const trimmed = text.trim();
  if (trimmed !== DEV_CALL_PREFIX && !trimmed.startsWith(`${DEV_CALL_PREFIX} `)) return undefined;
  const rest = trimmed.slice(DEV_CALL_PREFIX.length).trim();
  const space = rest.search(/\s/);
  const capability = space === -1 ? rest : rest.slice(0, space);
  const json = space === -1 ? "" : rest.slice(space).trim();
  if (!capability || !json) return { ok: false, message: USAGE };
  let input: unknown;
  try {
    input = JSON.parse(json);
  } catch {
    return { ok: false, message: `The input isn't valid JSON. ${USAGE}` };
  }
  // The user typed this call themselves: nothing untrusted shaped it. Main
  // still raises the flag if the agent has read untrusted content.
  return { ok: true, call: { capability, input, shapedByUntrusted: false } };
}

/** A result as plain chat text: output as JSON on success (labelled when untrusted), code + message on failure. */
export function formatResult(capability: string, result: CapabilityResult): string {
  let text: string;
  if (result.ok) {
    const label = result.untrusted ? "ok, untrusted output (shown as data)" : "ok";
    text = `${capability}: ${label}\n${JSON.stringify(result.output ?? null, null, 2)}`;
  } else {
    text = `${capability} failed: ${result.code}\n${result.message}`;
    if (result.hint) text += `\nHint: ${result.hint}`;
  }
  const suffix = "\n… (cut to fit a chat message)";
  return text.length <= MAX_TEXT_LENGTH ? text : text.slice(0, MAX_TEXT_LENGTH - suffix.length) + suffix;
}

/**
 * Runs `/call` through the agent's one capability path. Returns the chat reply,
 * or undefined when the text isn't a /call command (the agent answers as usual).
 */
export function runDevCall(text: string, client: Pick<CapabilityClient, "request">): Promise<string> | undefined {
  const parsed = parseDevCall(text);
  if (!parsed) return undefined;
  if (!parsed.ok) return Promise.resolve(parsed.message);
  return client.request(parsed.call).then((result) => formatResult(parsed.call.capability, result));
}
