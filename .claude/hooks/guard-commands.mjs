#!/usr/bin/env node
// PreToolUse hook (Bash|PowerShell): blocks a short list of commands that are
// destructive or leak secrets. Exit 2 blocks the call and tells Claude why.
import { readFileSync } from "node:fs";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const cmd = String(input?.tool_input?.command ?? "");
if (!cmd) process.exit(0);

const rules = [
  [/git\s+push\b[^\n]*(--force\b|-f\b|--force-with-lease\b)/i, "force push"],
  [/git\s+reset\s+--hard\b/i, "git reset --hard (ask the user first)"],
  [/git\s+clean\s+-[a-z]*f/i, "git clean -f (ask the user first)"],
  [/\brm\s+-[a-z]*r[a-z]*f?[a-z]*\s+(\/|~|[A-Za-z]:[\\/]|\$HOME|\.\.)(\s|$)/i, "recursive delete outside the repo"],
  [/Remove-Item\b[^\n]*-Recurse[^\n]*\s(['"]?[A-Za-z]:\\?['"]?|~|\$HOME|\$env:USERPROFILE|\.\.)(\s|$)/i, "recursive delete outside the repo"],
  [/\b(rd|rmdir)\s+\/s\b/i, "recursive delete (rd /s)"],
  [/\bformat(-volume)?\s+[A-Za-z]:/i, "formatting a drive"],
  [/(^|[\s'"\/\\])\.env(\.[\w-]+)?(\s|['"]|$)/, "reading or editing .env files"],
  [/(^|[\s'"\/\\])secrets[\/\\]/, "touching the secrets folder"],
];

for (const [re, what] of rules) {
  if (re.test(cmd)) {
    process.stderr.write(
      `Blocked by .claude/hooks/guard-commands.mjs: ${what}.\n` +
      `If this is really needed, explain why and ask the user to run it themselves.\n`
    );
    process.exit(2);
  }
}
process.exit(0);
