// Part of `pnpm lint`. Fails if packages/ui can render a string as HTML.
// Agent text, file contents and other outside content are untrusted; the UI
// must render them as text nodes only (see .claude/rules/ui.md).
//
// Usage: node scripts/check-no-raw-html.mjs [dir ...]   (default: packages/ui)
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";

const BANNED = [
  [/dangerouslySetInnerHTML/, "dangerouslySetInnerHTML"],
  [/\.innerHTML\b|\binnerHTML\s*[:=]/, "innerHTML"],
  [/\.outerHTML\b|\bouterHTML\s*[:=]/, "outerHTML"],
  [/\binsertAdjacentHTML\b/, "insertAdjacentHTML"],
  [/\bdocument\s*\.\s*write(ln)?\b/, "document.write"],
  [/\bcreateContextualFragment\b/, "createContextualFragment"],
  [/\bsrcdoc\b/i, "iframe srcdoc"],
  [/\bsetHTMLUnsafe\b|\bparseHTMLUnsafe\b/, "setHTMLUnsafe / parseHTMLUnsafe"],
];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".html"]);
const SKIP_DIRS = new Set(["node_modules", "dist", "out", "build", "coverage"]);

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* files(path);
    } else if (EXTENSIONS.has(extname(entry.name))) {
      yield path;
    }
  }
}

const roots = process.argv.length > 2 ? process.argv.slice(2) : [join("packages", "ui")];
const problems = [];
let scanned = 0;
for (const root of roots) {
  for (const file of files(root)) {
    scanned++;
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        for (const [pattern, name] of BANNED) {
          if (pattern.test(line)) problems.push(`${relative(process.cwd(), file)}:${i + 1}  ${name}`);
        }
      });
  }
}

if (problems.length > 0) {
  console.error("✖ raw HTML rendering found in the UI. Render untrusted text as text nodes:\n");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}
console.log(`✔ no raw HTML rendering in ${roots.join(", ")} (${scanned} files)`);
