import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "@totum/shared";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { canonicalFolder, canonicalScope, GrantStore, normalizeFolder, scopeCovers } from "./grants.js";

const folder = (path: string): Scope => ({ kind: "folder", path });

describe("normalizeFolder", () => {
  it("lower-cases, resolves dots and drops a trailing separator", () => {
    expect(normalizeFolder("C:\\Users\\Me\\Projects\\")).toBe("c:\\users\\me\\projects");
    expect(normalizeFolder("C:\\Users\\Me\\Docs\\..\\Projects")).toBe("c:\\users\\me\\projects");
    expect(normalizeFolder("c:/users/me/projects")).toBe("c:\\users\\me\\projects");
  });

  it("keeps a drive root's separator", () => {
    expect(normalizeFolder("C:\\")).toBe("c:\\");
  });

  it("refuses relative and drive-relative paths", () => {
    for (const bad of ["Projects", ".\\Projects", "..\\..\\Windows", "C:Projects", "\\Windows", "/Windows"]) {
      expect(normalizeFolder(bad), bad).toBeUndefined();
    }
  });

  it("accepts UNC shares", () => {
    expect(normalizeFolder("\\\\Server\\Share\\Docs")).toBe("\\\\server\\share\\docs");
  });

  it("refuses paths Windows reads differently from their text", () => {
    for (const bad of [
      "\\\\?\\C:\\A\\..\\Windows", // device namespace: the OS doesn't collapse ..
      "\\\\.\\C:\\A",
      "//?/C:/A",
      "C:\\A.", // Windows strips trailing dots and spaces: this is C:\A
      "C:\\A \\x",
      "C:\\A\\...",
      "C:\\A\\file.txt:secret", // alternate data stream
      "C:\\A\\nul",
      "C:\\A\\CON.txt",
      "C:\\A\\com1",
      "C:\\A\\conin$",
    ]) {
      expect(normalizeFolder(bad), bad).toBeUndefined();
    }
  });

  it("still accepts names that only look close to those", () => {
    for (const ok of ["C:\\A\\.config", "C:\\A\\console", "C:\\A\\nullable", "C:\\A\\a.b"]) {
      expect(normalizeFolder(ok), ok).toBeDefined();
    }
  });
});

describe("canonicalFolder", () => {
  // A fake file system: C:\A\link is a junction to C:\Windows; C:\A and C:\Windows exist.
  const links: Record<string, string> = {
    "c:\\": "C:\\",
    "c:\\a": "C:\\A",
    "c:\\a\\link": "C:\\Windows",
    "c:\\windows": "C:\\Windows",
  };
  const realpath = (p: string) => {
    const hit = links[p.toLowerCase()];
    if (hit === undefined) throw new Error("ENOENT");
    return hit;
  };

  it("follows a link in an existing path", () => {
    expect(canonicalFolder("C:\\A\\link\\System32", realpath)).toBe("c:\\windows\\system32");
  });

  it("keeps the parts that don't exist yet", () => {
    expect(canonicalFolder("C:\\A\\new\\deeper", realpath)).toBe("c:\\a\\new\\deeper");
  });

  it("refuses what normalizeFolder refuses", () => {
    expect(canonicalFolder("\\\\?\\C:\\A", realpath)).toBeUndefined();
  });

  it("makes a grant on C:\\A not cover a call through a link out of it", () => {
    const wanted = canonicalScope(folder("C:\\A\\link\\System32"), realpath)!;
    const granted = canonicalScope(folder("C:\\A"), realpath)!;
    expect(scopeCovers(granted, wanted)).toBe(false);
    // Why canonicalizing matters: the plain text comparison says yes.
    expect(scopeCovers(folder("C:\\A"), folder("C:\\A\\link\\System32"))).toBe(true);
  });

  it("follows a real junction on disk", () => {
    const base = mkdtempSync(join(tmpdir(), "totum-junction-"));
    try {
      const granted = join(base, "granted");
      const outside = join(base, "outside");
      mkdirSync(granted);
      mkdirSync(outside);
      symlinkSync(outside, join(granted, "link"), "junction");
      const real = (p: string) => realpathSync.native(p);
      const wanted = canonicalScope(folder(join(granted, "link", "x")), real)!;
      expect(wanted).toEqual(folder(normalizeFolder(join(realpathSync.native(outside), "x"))!));
      expect(scopeCovers(canonicalScope(folder(granted), real)!, wanted)).toBe(false);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("leaves apps and accounts alone", () => {
    expect(canonicalScope({ kind: "app", app: "x" }, realpath)).toEqual({ kind: "app", app: "x" });
  });
});

describe("scopeCovers", () => {
  it("covers the same folder whatever its case or trailing separator", () => {
    expect(scopeCovers(folder("C:\\A"), folder("c:\\a\\"))).toBe(true);
  });

  it("covers subfolders", () => {
    expect(scopeCovers(folder("C:\\A"), folder("c:\\a\\b\\c"))).toBe(true);
    expect(scopeCovers(folder("C:\\"), folder("C:\\Windows"))).toBe(true);
  });

  it("does not cover a sibling sharing a name prefix", () => {
    expect(scopeCovers(folder("C:\\A"), folder("C:\\AB"))).toBe(false);
    expect(scopeCovers(folder("C:\\Users\\me"), folder("C:\\Users\\me-evil\\x"))).toBe(false);
  });

  it("does not let .. climb out of the granted folder", () => {
    expect(scopeCovers(folder("C:\\A"), folder("C:\\A\\..\\B"))).toBe(false);
    expect(scopeCovers(folder("C:\\A"), folder("C:\\A\\b\\..\\..\\Windows"))).toBe(false);
  });

  it("does not cover parents, other drives or relative paths", () => {
    expect(scopeCovers(folder("C:\\A\\B"), folder("C:\\A"))).toBe(false);
    expect(scopeCovers(folder("C:\\A"), folder("D:\\A"))).toBe(false);
    expect(scopeCovers(folder("C:\\A"), folder("A\\b"))).toBe(false);
    expect(scopeCovers(folder("A"), folder("A"))).toBe(false);
  });

  it("matches apps and accounts exactly, ignoring case", () => {
    expect(scopeCovers({ kind: "app", app: "Code" }, { kind: "app", app: "code" })).toBe(true);
    expect(scopeCovers({ kind: "app", app: "Code" }, { kind: "app", app: "code2" })).toBe(false);
    expect(scopeCovers({ kind: "account", account: "Me@x.com" }, { kind: "account", account: "me@x.com" })).toBe(true);
  });

  it("never matches across kinds", () => {
    expect(scopeCovers({ kind: "app", app: "C:\\A" }, folder("C:\\A"))).toBe(false);
    expect(scopeCovers(folder("C:\\A"), { kind: "app", app: "C:\\A" })).toBe(false);
  });
});

describe("GrantStore", () => {
  const app: Scope = { kind: "app", app: "totum-test" };
  let dir: string | undefined;

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("has no grants to start with", () => {
    const store = new GrantStore(openDb(":memory:"));
    expect(store.has("test.echo", app)).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it("grants only the capability and scope it was given", () => {
    const store = new GrantStore(openDb(":memory:"));
    store.add({ capability: "test.echo", scope: folder("C:\\Projects"), lifetime: "session" });
    expect(store.has("test.echo", folder("c:\\projects\\totum"))).toBe(true);
    expect(store.has("test.note", folder("C:\\Projects"))).toBe(false);
    expect(store.has("test.echo", folder("C:\\Other"))).toBe(false);
  });

  it("keeps always grants across a restart, and session grants only in memory", () => {
    dir = mkdtempSync(join(tmpdir(), "totum-grants-"));
    const file = join(dir, "totum.db");
    const db = openDb(file);
    const store = new GrantStore(db);
    store.add({ capability: "test.echo", scope: app, lifetime: "always" });
    store.add({ capability: "test.note", scope: app, lifetime: "session" });
    db.close();

    const reopened = openDb(file);
    const after = new GrantStore(reopened);
    expect(after.has("test.echo", app)).toBe(true);
    expect(after.has("test.note", app)).toBe(false);
    reopened.close();
  });

  it("doesn't duplicate a grant added twice", () => {
    const store = new GrantStore(openDb(":memory:"));
    for (let i = 0; i < 2; i++) {
      store.add({ capability: "test.echo", scope: app, lifetime: "always" });
      store.add({ capability: "test.echo", scope: { kind: "app", app: "TOTUM-TEST" }, lifetime: "session" });
    }
    expect(store.list()).toHaveLength(2);
  });

  it("revokes both lifetimes for that capability and scope only", () => {
    const store = new GrantStore(openDb(":memory:"));
    store.add({ capability: "test.echo", scope: app, lifetime: "always" });
    store.add({ capability: "test.echo", scope: app, lifetime: "session" });
    store.add({ capability: "test.note", scope: app, lifetime: "session" });
    store.revoke("test.echo", app);
    expect(store.has("test.echo", app)).toBe(false);
    expect(store.has("test.note", app)).toBe(true);
  });

  it("ignores a stored row it can't read instead of granting", () => {
    const db = openDb(":memory:");
    db.prepare("insert into grants (capability, scope_kind, scope_value, created) values (?, ?, ?, ?)").run(
      "test.echo",
      "site",
      "example.com",
      "now",
    );
    const store = new GrantStore(db);
    expect(store.list()).toEqual([]);
  });
});
