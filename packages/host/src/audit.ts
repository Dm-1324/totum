// The audit log: one row per capability call, whatever its outcome. A call
// that passes validation gets a `pending` row before anything can block or run,
// so a crash mid-call still leaves a trace; the row is finished afterwards.
import { type Approver, AuditEntry, ErrorCode, type Scope, Scope as ScopeSchema, type Tier, type UndoToken } from "@totum/shared";
import type { Db } from "./db.js";

export const PENDING = "pending";

/** Longest stored input; longer inputs are cut and marked. Matches AuditEntry.input. */
export const MAX_AUDIT_INPUT = 20_000;
const TRUNCATED = "…[truncated]";

export interface AuditStart {
  taskId: string;
  capability: string;
  tier: Tier | null;
  scope: Scope | null;
  /** Already redacted by the capability. */
  input: unknown;
}

export interface AuditFinish {
  outcome: string;
  approver: Approver;
  untrusted: boolean;
  undo?: UndoToken | undefined;
}

/** An entry plus what only the host needs: the undo token. */
export interface StoredAuditEntry extends AuditEntry {
  undoToken: UndoToken | undefined;
}

export function serializeInput(input: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(input) ?? "null";
  } catch {
    text = '"[unserializable input]"';
  }
  return text.length > MAX_AUDIT_INPUT ? text.slice(0, MAX_AUDIT_INPUT - TRUNCATED.length) + TRUNCATED : text;
}

const cap = (text: string, max: number) => (text.length > max ? text.slice(0, max) : text);

/** A capability's code that isn't a valid ErrorCode would make its row unreadable; store a marker instead. */
export function storedOutcome(outcome: string): string {
  return ErrorCode.safeParse(outcome).success ? outcome : "invalid_code";
}

export class AuditLog {
  constructor(
    private readonly db: Db,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Writes a pending row; returns its id. */
  begin(start: AuditStart): number {
    return this.insert(start, { outcome: PENDING, approver: "none", untrusted: false });
  }

  finish(id: number, finish: AuditFinish): void {
    this.db
      .prepare("update audit set outcome = ?, approver = ?, untrusted = ?, undo_token = ? where id = ?")
      .run(
        storedOutcome(finish.outcome),
        finish.approver,
        finish.untrusted ? 1 : 0,
        finish.undo === undefined ? null : JSON.stringify(finish.undo),
        id,
      );
  }

  /** A call that ended before it could block or run (unknown capability, invalid input). */
  record(start: AuditStart, finish: AuditFinish): number {
    return this.insert(start, finish);
  }

  markUndone(id: number): void {
    this.db.prepare("update audit set undone = 1 where id = ?").run(id);
  }

  /** Newest first. */
  list(limit = 200): AuditEntry[] {
    const rows = this.db.prepare("select * from audit order by id desc limit ?").all(limit);
    return rows.flatMap((row) => {
      const entry = toEntry(row);
      if (!entry) return [];
      const { undoToken: _token, ...visible } = entry;
      return [visible];
    });
  }

  get(id: number): StoredAuditEntry | undefined {
    const row = this.db.prepare("select * from audit where id = ?").get(id);
    return row ? toEntry(row) : undefined;
  }

  private insert(start: AuditStart, finish: AuditFinish): number {
    const result = this.db
      .prepare(
        `insert into audit (time, task_id, capability, tier, scope, input, outcome, approver, untrusted, undo_token)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.now().toISOString(),
        cap(start.taskId, 64),
        cap(start.capability, 64),
        start.tier,
        start.scope ? JSON.stringify(start.scope) : null,
        serializeInput(start.input),
        storedOutcome(finish.outcome),
        finish.approver,
        finish.untrusted ? 1 : 0,
        finish.undo === undefined ? null : JSON.stringify(finish.undo),
      );
    return Number(result.lastInsertRowid);
  }
}

function parseJson(text: unknown): unknown {
  if (typeof text !== "string") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function toEntry(row: Record<string, unknown>): StoredAuditEntry | undefined {
  const scope = row["scope"] === null ? null : ScopeSchema.safeParse(parseJson(row["scope"])).data;
  const parsed = AuditEntry.safeParse({
    id: row["id"],
    time: row["time"],
    taskId: row["task_id"],
    capability: row["capability"],
    tier: row["tier"],
    scope: scope === undefined ? "unreadable" : scope,
    input: row["input"],
    outcome: row["outcome"],
    approver: row["approver"],
    untrusted: row["untrusted"] === 1,
    undoable: typeof row["undo_token"] === "string" && row["undone"] === 0,
    undone: row["undone"] === 1,
  });
  if (!parsed.success) return undefined;
  const token = row["undo_token"] === null ? undefined : (parseJson(row["undo_token"]) as UndoToken | undefined);
  return { ...parsed.data, undoToken: token };
}
