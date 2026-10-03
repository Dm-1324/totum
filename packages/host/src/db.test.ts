import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, transaction } from "./db.js";

describe("openDb", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "totum-db-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates the schema once and reopens without re-running migrations", () => {
    const file = join(dir, "totum.db");
    const db = openDb(file);
    const version = db.prepare("pragma user_version").get()?.["user_version"];
    expect(version).toBeGreaterThan(0);
    db.prepare("insert into grants (capability, scope_kind, scope_value, created) values ('test.echo','app','x','now')").run();
    db.close();

    const again = openDb(file);
    expect(again.prepare("pragma user_version").get()?.["user_version"]).toBe(version);
    expect(again.prepare("select count(*) as n from grants").get()?.["n"]).toBe(1);
    again.close();
  });

  it("refuses a database written by a newer Totum", () => {
    const file = join(dir, "totum.db");
    const db = openDb(file);
    db.exec("pragma user_version = 99");
    db.close();
    expect(() => openDb(file)).toThrow(/newer than this Totum/);
  });
});

describe("transaction", () => {
  it("rolls back when the function throws", () => {
    const db = openDb(":memory:");
    expect(() =>
      transaction(db, () => {
        db.prepare("insert into grants (capability, scope_kind, scope_value, created) values ('a.b','app','x','now')").run();
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(db.prepare("select count(*) as n from grants").get()?.["n"]).toBe(0);
  });
});
