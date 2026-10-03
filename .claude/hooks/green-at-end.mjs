#!/usr/bin/env node
// Stop hook: before Claude finishes a turn, typecheck and test only the
// packages touched since the last commit. Exit 2 keeps Claude working and
// shows it the failure. Skips quietly when nothing relevant changed, when
// dependencies aren't installed yet, or when it already fired this turn.
import { readFileSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
if (input.stop_hook_active) process.exit(0); // avoid loops

const root = process.env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
const run = (c) => execSync(c, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

if (!existsSync(path.join(root, "node_modules"))) process.exit(0);

let changed = "";
try {
  changed = run("git status --porcelain --untracked-files=all");
} catch {
  process.exit(0); // not a git repo yet
}

const pkgs = new Set();
for (const line of changed.split("\n")) {
  const f = line.slice(3).trim().replace(/^"|"$/g, "").split(" -> ").pop();
  const m = f && f.match(/^packages\/([^/]+)\//);
  if (m && /\.(c|m)?(t|j)sx?$|package\.json$|tsconfig.*\.json$/.test(f)) pkgs.add(m[1]);
}
if (pkgs.size === 0) process.exit(0);

// shared is a dependency of everything: if it changed, check all packages.
const filters = pkgs.has("shared")
  ? ["--recursive"]
  : [...pkgs].map((p) => `--filter @totum/${p}`);

const failures = [];
for (const script of ["typecheck", "test"]) {
  try {
    run(`pnpm ${filters.join(" ")} --if-present ${script}`);
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim().split("\n").slice(-40).join("\n");
    failures.push(`pnpm ${script} failed for ${[...pkgs].join(", ")}:\n${out}`);
  }
}
if (failures.length === 0) process.exit(0);

process.stderr.write(
  `Not green yet (.claude/hooks/green-at-end.mjs):\n\n${failures.join("\n\n")}\n\n` +
  `Fix these before finishing, or tell the user exactly what is still failing and why.\n`
);
process.exit(2);
