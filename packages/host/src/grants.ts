// Grants: which capability may touch which scope, for how long.
// Session grants live in memory and end when the host stops; `always` grants
// are stored in SQLite. Which lifetimes a call may get is the engine's rule.
import { win32 } from "node:path";
import { CapabilityId, type Grant, type Scope } from "@totum/shared";
import type { Db } from "./db.js";

/** Totum runs on Windows: folder scopes use Windows path rules on every OS, so tests match production. */
const paths = win32;

/** `C:\...` or `\\server\share\...`; nothing that depends on the current drive or folder. */
const FULLY_QUALIFIED = /^(?:[a-zA-Z]:[\\/]|[\\/]{2}[^\\/?.][^\\/]*[\\/][^\\/]+)/;
/** `\\?\` and `\\.\` paths skip Windows' own normalization, so `..` in them means something else to the OS. */
const DEVICE_NAMESPACE = /^[\\/]{2}[?.][\\/]/;
/** Names Windows maps to devices in any folder, with or without an extension. */
const RESERVED_NAME = /^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³]|conin\$|conout\$)(?:\..*)?$/i;

/**
 * A folder path in comparable form: fully qualified, resolved (no `.` / `..`),
 * lower case, no trailing separator except on a drive root.
 *
 * Undefined, and so matching nothing, for any path Windows would read
 * differently from this text: relative or drive-relative paths, device
 * namespace paths, a name ending in a dot or space (Windows strips them, so
 * `C:\A.` is `C:\A`), a colon after the drive (alternate data stream) and
 * reserved device names. Links are not followed here; see canonicalFolder.
 */
export function normalizeFolder(path: string): string | undefined {
  if (DEVICE_NAMESPACE.test(path) || !FULLY_QUALIFIED.test(path)) return undefined;
  let resolved = paths.resolve(path).toLowerCase();
  const root = paths.parse(resolved).root;
  const segments = resolved.slice(root.length).split(paths.sep).filter((s) => s.length > 0);
  for (const segment of segments) {
    if (segment.includes(":") || /[. ]$/.test(segment) || RESERVED_NAME.test(segment)) return undefined;
  }
  if (resolved.length > root.length && resolved.endsWith(paths.sep)) {
    resolved = resolved.slice(0, -1);
  }
  return resolved;
}

/** Resolves links in an existing path (fs.realpathSync.native in production). Throws if it doesn't exist. */
export type RealPath = (path: string) => string;

/**
 * The folder a path really reaches: the deepest existing ancestor with its
 * junctions and symlinks resolved, plus the parts that don't exist yet. A
 * grant check on `C:\A\link\x` where `link` points to `C:\Windows` then sees
 * `C:\Windows\x`. Undefined when normalizeFolder refuses the path.
 *
 * The engine checks grants on this form. A capability that acts on a folder
 * must act on the same canonical path, or a link swapped in between check and
 * use would defeat it (milestone 4).
 */
export function canonicalFolder(path: string, realpath: RealPath): string | undefined {
  const normalized = normalizeFolder(path);
  if (normalized === undefined) return undefined;
  const missing: string[] = [];
  let current = normalized;
  for (;;) {
    try {
      const real = realpath(current);
      const joined = missing.length > 0 ? paths.join(real, ...missing.reverse()) : real;
      return normalizeFolder(joined);
    } catch {
      const parent = paths.dirname(current);
      if (parent === current) return normalized;
      missing.push(paths.basename(current));
      current = parent;
    }
  }
}

/** A scope with its folder made canonical; apps and accounts unchanged. Undefined if the folder is refused. */
export function canonicalScope(scope: Scope, realpath: RealPath): Scope | undefined {
  if (scope.kind !== "folder") return scope;
  const path = canonicalFolder(scope.path, realpath);
  return path === undefined ? undefined : { kind: "folder", path };
}

/** Does a grant for `granted` cover a call touching `wanted`? Folders cover their subfolders. */
export function scopeCovers(granted: Scope, wanted: Scope): boolean {
  switch (granted.kind) {
    case "folder": {
      if (wanted.kind !== "folder") return false;
      const root = normalizeFolder(granted.path);
      const target = normalizeFolder(wanted.path);
      if (root === undefined || target === undefined) return false;
      if (target === root) return true;
      const prefix = root.endsWith(paths.sep) ? root : root + paths.sep;
      return target.startsWith(prefix);
    }
    case "app":
      return wanted.kind === "app" && wanted.app.toLowerCase() === granted.app.toLowerCase();
    case "account":
      return wanted.kind === "account" && wanted.account.toLowerCase() === granted.account.toLowerCase();
  }
}

function scopeValue(scope: Scope): string {
  switch (scope.kind) {
    case "folder":
      return scope.path;
    case "app":
      return scope.app;
    case "account":
      return scope.account;
  }
}

function scopeFrom(kind: unknown, value: unknown): Scope | undefined {
  if (typeof value !== "string" || value.length === 0) return undefined;
  switch (kind) {
    case "folder":
      return { kind, path: value };
    case "app":
      return { kind, app: value };
    case "account":
      return { kind, account: value };
    default:
      return undefined;
  }
}

function sameScope(a: Scope, b: Scope): boolean {
  return scopeCovers(a, b) && scopeCovers(b, a);
}

export class GrantStore {
  private readonly session: Grant[] = [];

  constructor(private readonly db: Db) {}

  /** True when a session or always grant for this capability covers `scope`. */
  has(capability: string, scope: Scope): boolean {
    return this.list().some((g) => g.capability === capability && scopeCovers(g.scope, scope));
  }

  add(grant: Grant): void {
    if (grant.lifetime === "always") {
      this.db
        .prepare(
          `insert into grants (capability, scope_kind, scope_value, created) values (?, ?, ?, ?)
           on conflict (capability, scope_kind, scope_value) do nothing`,
        )
        .run(grant.capability, grant.scope.kind, scopeValue(grant.scope), new Date().toISOString());
      return;
    }
    if (!this.session.some((g) => g.capability === grant.capability && sameScope(g.scope, grant.scope))) {
      this.session.push(grant);
    }
  }

  /** Removes every grant (either lifetime) for exactly this capability and scope. */
  revoke(capability: string, scope: Scope): void {
    for (const stored of this.stored()) {
      if (stored.grant.capability === capability && sameScope(stored.grant.scope, scope)) {
        this.db.prepare("delete from grants where id = ?").run(stored.id);
      }
    }
    for (let i = this.session.length - 1; i >= 0; i--) {
      const g = this.session[i]!;
      if (g.capability === capability && sameScope(g.scope, scope)) this.session.splice(i, 1);
    }
  }

  list(): Grant[] {
    return [...this.stored().map((s) => s.grant), ...this.session];
  }

  private stored(): Array<{ id: number; grant: Grant }> {
    const rows = this.db.prepare("select id, capability, scope_kind, scope_value from grants order by id").all();
    const grants: Array<{ id: number; grant: Grant }> = [];
    for (const row of rows) {
      const scope = scopeFrom(row["scope_kind"], row["scope_value"]);
      const capability = CapabilityId.safeParse(row["capability"]);
      // A row we can't read grants nothing.
      if (!scope || !capability.success || typeof row["id"] !== "number") continue;
      grants.push({ id: row["id"], grant: { capability: capability.data, scope, lifetime: "always" } });
    }
    return grants;
  }
}
