import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** True only for the agent's own files: file: URLs inside the agent page's folder. */
export function isAllowedAgentRequest(url: string, agentDir: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "file:") return false;
    const file = resolve(fileURLToPath(parsed)).toLowerCase();
    const dir = (resolve(agentDir) + sep).toLowerCase();
    return file.startsWith(dir);
  } catch {
    return false;
  }
}
