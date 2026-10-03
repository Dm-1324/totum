import { lstatSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope } from "@totum/shared";
import { afterEach, describe, expect, it } from "vitest";
import { openDb } from "./db.js";
import { canonicalFolder, canonicalScope, GrantStore, normalizeFolder, type PathProbe, scopeCovers } from "./grants.js";

const folder = (path: string): Scope => ({ kind: "folder", path });
/** Windows paths as written: w`C:\A\x` is the text C:\A\x. (A raw string can't end in a backslash, hence `C:\ `.trim().) */
const w = String.raw;

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

  it("refuses UNC shares, so a scope never reaches the network", () => {
    for (const bad of [w`\\Server\Share\Docs`, "//server/share/docs", w`\\attacker\x`]) {
      expect(normalizeFolder(bad), bad).toBeUndefined();
    }
  });

  it("refuses paths Windows reads differently from their text", () => {
    for (const bad of [
      w`\\?\C:\A\..\Windows`, // device namespace: the OS doesn't collapse ..
      w`\\.\C:\A`,
      "//?/C:/A",
      w`C:\A.`, // Windows strips trailing dots and spaces: this is C:\A
      w`C:\A \x`,
      w`C:\A\...`,
      w`C:\A\file.txt:secret`, // alternate data stream
      w`C:\A\nul`,
      w`C:\A\CON.txt`,
      w`C:\A\com1`,
      w`C:\A\conin$`,
    ]) {
      expect(normalizeFolder(bad), bad).toBeUndefined();
    }
  });

  it("still accepts names that only look close to those", () => {
    for (const ok of [w`C:\A\.config`, w`C:\A\console`, w`C:\A\nullable`, w`C:\A\a.b`]) {
      expect(normalizeFolder(ok), ok).toBeDefined();
    }
  });
});

/** A fake file system. `links` maps lower-case paths that exist to what they resolve to. */
function fakeFs(links: Record<string, string>, extra: { dangling?: string[]; denied?: string[] } = {}) {
  const calls: string[] = [];
  const probe: PathProbe = {
    realpath(p) {
      const key = p.toLowerCase();
      calls.push(key);
      if (extra.denied?.includes(key)) throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      const hit = links[key];
      if (hit === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return hit;
    },
    exists: (p) => p.toLowerCase() in links || (extra.dangling?.includes(p.toLowerCase()) ?? false),
  };
  return { probe, calls };
}

describe("canonicalFolder", () => {
  // C:\A\link is a junction to C:\Windows; C:\A and C:\Windows exist.
  const { probe: fs } = fakeFs({
    [w`c:\ `.trim()]: w`C:\ `.trim(),
    [w`c:\a`]: w`C:\A`,
    [w`c:\a\link`]: w`C:\Windows`,
    [w`c:\windows`]: w`C:\Windows`,
  });

  it("follows a link in an existing path", () => {
    expect(canonicalFolder(w`C:\A\link\System32`, fs)).toBe(w`c:\windows\system32`);
  });

  it("keeps the parts that don't exist yet", () => {
    expect(canonicalFolder(w`C:\A\new\deeper`, fs)).toBe(w`c:\a\new\deeper`);
  });

  it("refuses what normalizeFolder refuses, without touching the file system", () => {
    const { probe, calls } = fakeFs({});
    expect(canonicalFolder(w`\\?\C:\A`, probe)).toBeUndefined();
    expect(canonicalFolder(w`\\attacker\share\x`, probe)).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it("refuses a dangling link instead of treating it as a new folder", () => {
    // C:\A\link points to something that doesn't exist yet; creating through it could land anywhere.
    const { probe } = fakeFs({ [w`c:\ `.trim()]: w`C:\ `.trim(), [w`c:\a`]: w`C:\A` }, { dangling: [w`c:\a\link`] });
    expect(canonicalFolder(w`C:\A\link\x`, probe)).toBeUndefined();
  });

  it("refuses when resolving fails for any reason but not-found", () => {
    const { probe } = fakeFs({ [w`c:\ `.trim()]: w`C:\ `.trim() }, { denied: [w`c:\a`] });
    expect(canonicalFolder(w`C:\A\x`, probe)).toBeUndefined();
  });

  it("refuses when existence can't be checked", () => {
    const probe: PathProbe = {
      realpath: () => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      },
      exists: () => {
        throw new Error("EPERM");
      },
    };
    expect(canonicalFolder(w`C:\A`, probe)).toBeUndefined();
  });

  it("refuses a drive that doesn't exist", () => {
    const { probe } = fakeFs({});
    expect(canonicalFolder(w`Q:\A`, probe)).toBeUndefined();
  });

  it("refuses a link that resolves to a network share", () => {
    const { probe } = fakeFs({ [w`c:\ `.trim()]: w`C:\ `.trim(), [w`c:\a`]: w`\\attacker\share` });
    expect(canonicalFolder(w`C:\A\x`, probe)).toBeUndefined();
  });

  it("makes a grant on C:\\A not cover a call through a link out of it", () => {
    const wanted = canonicalScope(folder(w`C:\A\link\System32`), fs)!;
    const granted = canonicalScope(folder(w`C:\A`), fs)!;
    expect(scopeCovers(granted, wanted)).toBe(false);
    // Why canonicalizing matters: the plain text comparison says yes.
    expect(scopeCovers(folder(w`C:\A`), folder(w`C:\A\link\System32`))).toBe(true);
  });

  it("follows a real junction on disk, and refuses a real dangling one", () => {
    const base = mkdtempSync(join(tmpdir(), "totum-junction-"));
    try {
      const granted = join(base, "granted");
      const outside = join(base, "outside");
      mkdirSync(granted);
      mkdirSync(outside);
      symlinkSync(outside, join(granted, "link"), "junction");
      symlinkSync(join(base, "not-yet"), join(granted, "dangling"), "junction");
      const real: PathProbe = {
        realpath: (p) => realpathSync.native(p),
        exists: (p) => {
          try {
            lstatSync(p);
            return true;
          } catch {
            return false;
          }
        },
      };
      const wanted = canonicalScope(folder(join(granted, "link", "x")), real)!;
      expect(wanted).toEqual(folder(normalizeFolder(join(realpathSync.native(outside), "x"))!));
      expect(scopeCovers(canonicalScope(folder(granted), real)!, wanted)).toBe(false);
      expect(canonicalFolder(join(granted, "dangling", "x"), real)).toBeUndefined();
      expect(canonicalFolder(join(granted, "new", "x"), real)).toBeDefined();
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("leaves apps and accounts alone", () => {
    expect(canonicalScope({ kind: "app", app: "x" }, fs)).toEqual({ kind: "app", app: "x" });
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
