// The host's SQLite database (ADR 0005: node:sqlite, no native module).
// One file in the user's app-data folder; main passes its path.
import { DatabaseSync } from "node:sqlite";

export type Db = DatabaseSync;

/**
 * Schema migrations, applied in order. Never edit a shipped one; append a new
 * one. `pragma user_version` records how many have run.
 */
const MIGRATIONS: readonly string[] = [
  `create table grants (
     id integer primary key,
     capability text not null,
     scope_kind text not null,
     scope_value text not null,
     created text not null,
     unique (capability, scope_kind, scope_value)
   );
   create table audit (
     id integer primary key autoincrement,
     time text not null,
     task_id text not null,
     capability text not null,
     tier integer,
     scope text,
     input text not null,
     outcome text not null,
     approver text not null,
     untrusted integer not null default 0,
     undo_token text,
     undone integer not null default 0
   );`,
];

/** Opens (or creates) the database at `path` and brings its schema up to date. `:memory:` for tests. */
export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  try {
    db.exec("pragma foreign_keys = on");
    if (path !== ":memory:") db.exec("pragma journal_mode = wal");
    migrate(db);
  } catch (error) {
    // Don't leave the file open (and locked on Windows) when we refuse it.
    db.close();
    throw error;
  }
  return db;
}

function migrate(db: Db): void {
  const row = db.prepare("pragma user_version").get();
  const version = typeof row?.["user_version"] === "number" ? row["user_version"] : 0;
  if (version > MIGRATIONS.length) {
    throw new Error(`database schema ${version} is newer than this Totum (${MIGRATIONS.length}); update Totum`);
  }
  for (let i = version; i < MIGRATIONS.length; i++) {
    db.exec("begin");
    try {
      db.exec(MIGRATIONS[i]!);
      db.exec(`pragma user_version = ${i + 1}`);
      db.exec("commit");
    } catch (error) {
      db.exec("rollback");
      throw error;
    }
  }
}

/** Runs `fn` in a transaction. */
export function transaction<T>(db: Db, fn: () => T): T {
  db.exec("begin");
  try {
    const result = fn();
    db.exec("commit");
    return result;
  } catch (error) {
    db.exec("rollback");
    throw error;
  }
}
