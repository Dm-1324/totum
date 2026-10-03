// Host implementations of the milestone-2 test capabilities (specs in
// packages/shared/src/capabilities/test.ts). They touch only two tables of
// Totum's own database. Dev and test builds only: index.ts registers them
// behind __TOTUM_DEV__, so production bundles leave this module out.
import {
  type Capability,
  type Result,
  type Scope,
  type TestDangerInput,
  type TestDangerOutput,
  testDangerSpec,
  type TestEchoInput,
  type TestEchoOutput,
  testEchoSpec,
  type TestNoteInput,
  type TestNoteOutput,
  testNoteSpec,
  type TestSendInput,
  type TestSendOutput,
  testSendSpec,
} from "@totum/shared";
import type { Db } from "../db.js";
import { type AnyCapability, erase } from "../engine.js";

export const TEST_APP: Scope = { kind: "app", app: "totum-test" };
export const NOTES_APP: Scope = { kind: "app", app: "totum-test-notes" };
export const OUTBOX_ACCOUNT: Scope = { kind: "account", account: "totum-test-outbox" };

/** Quotes user text in full: a describe() never shortens what will run. */
const quote = (text: string) => JSON.stringify(text);

function readNote(db: Db, id: number): string | undefined {
  const row = db.prepare("select text from test_notes where id = ?").get(id);
  return typeof row?.["text"] === "string" ? row["text"] : undefined;
}

function countNotes(db: Db): number {
  const n = db.prepare("select count(*) as n from test_notes").get()?.["n"];
  return typeof n === "number" ? n : 0;
}

/** Creates the test tables if needed and returns the four test capabilities. */
export function createTestCapabilities(db: Db): AnyCapability[] {
  db.exec(`
    create table if not exists test_notes (id integer primary key autoincrement, text text not null);
    create table if not exists test_outbox (id integer primary key autoincrement, recipient text not null, body text not null);
  `);

  const echo: Capability<TestEchoInput, TestEchoOutput> = {
    ...testEchoSpec,
    scopeOf: () => TEST_APP,
    describe: (input) => `Echo back the text ${quote(input.text)}`,
    // Marked untrusted, like text read from a file or page, so the taint path can be seen in dev.
    run: async (input) => ({ ok: true, output: { text: input.text }, untrusted: true }),
  };

  const note: Capability<TestNoteInput, TestNoteOutput> = {
    ...testNoteSpec,
    scopeOf: () => NOTES_APP,
    describe: (input) => `Save the note ${quote(input.text)} in Totum's test notebook`,
    run: async (input) => {
      const result = db.prepare("insert into test_notes (text) values (?)").run(input.text);
      const noteId = Number(result.lastInsertRowid);
      return { ok: true, output: { noteId }, untrusted: false, undo: { noteId, text: input.text } };
    },
    verify: async (input, output) => readNote(db, output.noteId) === input.text,
    undo: async ({ token }): Promise<Result<null>> => {
      const noteId = typeof token === "object" && token && !Array.isArray(token) ? token["noteId"] : undefined;
      const text = typeof token === "object" && token && !Array.isArray(token) ? token["text"] : undefined;
      if (typeof noteId !== "number" || typeof text !== "string") {
        return { ok: false, code: "undo_failed", message: "This entry's undo record is unreadable." };
      }
      const current = readNote(db, noteId);
      if (current === undefined) {
        return { ok: false, code: "changed_since", message: "That note is already gone.", hint: "Nothing to undo." };
      }
      if (current !== text) {
        return { ok: false, code: "changed_since", message: "That note changed since it was saved; Totum left it alone." };
      }
      db.prepare("delete from test_notes where id = ?").run(noteId);
      return { ok: true, output: null, untrusted: false };
    },
  };

  const danger: Capability<TestDangerInput, TestDangerOutput> = {
    ...testDangerSpec,
    scopeOf: () => NOTES_APP,
    describe: () => `Delete all ${countNotes(db)} notes in Totum's test notebook. This can't be undone.`,
    run: async () => {
      const result = db.prepare("delete from test_notes").run();
      return { ok: true, output: { cleared: Number(result.changes) }, untrusted: false };
    },
    verify: async () => countNotes(db) === 0,
  };

  const send: Capability<TestSendInput, TestSendOutput> = {
    ...testSendSpec,
    scopeOf: () => OUTBOX_ACCOUNT,
    describe: (input) =>
      `Send from ${OUTBOX_ACCOUNT.kind === "account" ? OUTBOX_ACCOUNT.account : ""} to ${input.to}: ${quote(input.body)} ` +
      "(test only: it goes to a local outbox)",
    run: async (input) => {
      db.prepare("insert into test_outbox (recipient, body) values (?, ?)").run(input.to, input.body);
      return { ok: true, output: { queued: true }, untrusted: false };
    },
    verify: async (input) =>
      db.prepare("select 1 as hit from test_outbox where recipient = ? and body = ? limit 1").get(input.to, input.body) !==
      undefined,
  };

  return [erase(echo), erase(note), erase(danger), erase(send)];
}
