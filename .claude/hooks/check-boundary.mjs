#!/usr/bin/env node
// PostToolUse hook (Edit|Write|MultiEdit): enforces "the one rule".
// Files in packages/agent, packages/ui and packages/shared must not import
// OS-level modules or @totum/host. Exit 2 sends the message back to Claude.
// Fast and dependency-free on purpose; `pnpm lint` (dependency-cruiser) is the
// thorough check.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const filePath = input?.tool_input?.file_path;
if (!filePath || !/\.(c|m)?(t|j)sx?$/.test(filePath) || !existsSync(filePath)) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const rel = path.relative(root, filePath).split(path.sep).join("/");
const m = rel.match(/^packages\/(agent|ui|shared)\//);
if (!m) process.exit(0);
const pkg = m[1];

const OS_MODULES = [
  "fs", "fs/promises", "child_process", "net", "http", "https", "http2", "os",
  "worker_threads", "cluster", "dgram", "tls", "dns", "electron",
];
const banned = (spec) => {
  const bare = spec.replace(/^node:/, "");
  if (OS_MODULES.includes(bare)) return `Node/Electron OS module "${spec}"`;
  if (spec === "@totum/host" || spec.startsWith("@totum/host/")) return `"${spec}" (host internals)`;
  if (/(^|\/)packages\/host(\/|$)/.test(spec)) return `"${spec}" (host internals)`;
  if (pkg === "shared" && spec.startsWith("@totum/")) return `"${spec}" (shared must not depend on other packages)`;
  return null;
};

const src = readFileSync(filePath, "utf8");
const specRe = /(?:import\s+(?:[^'"]*?\s+from\s+)?|export\s+[^'"]*?\s+from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;
const problems = [];
for (const match of src.matchAll(specRe)) {
  const why = banned(match[1]);
  if (why) {
    const line = src.slice(0, match.index).split("\n").length;
    problems.push(`  ${rel}:${line} imports ${why}`);
  }
}
if (problems.length === 0) process.exit(0);

process.stderr.write(
  `BOUNDARY VIOLATION (the one rule in CLAUDE.md):\n${problems.join("\n")}\n` +
  `Only packages/host may touch the OS. In packages/${pkg}, request a capability ` +
  `over IPC instead (see the add-capability and ipc-message skills). ` +
  `Revert this import now; do not work around the check.\n`
);
process.exit(2);
