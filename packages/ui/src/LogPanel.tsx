import type { Approver, AuditEntry, TotumApi } from "@totum/shared";
import { useCallback, useEffect, useState } from "react";
import { scopeLabel, timeLabel } from "./format.js";

const APPROVERS: Record<Approver, string> = { user: "You", grant: "Grant", none: "Nobody" };
const UNREACHABLE = "Couldn't reach Totum. Try again, or restart Totum if this keeps happening.";

/** Every capability call, newest first, whatever its outcome. Undo where the call can be reversed. */
export function LogPanel({ api }: { api: Pick<TotumApi, "listAudit" | "undo"> }) {
  const [entries, setEntries] = useState<readonly AuditEntry[]>([]);
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const reply = await api.listAudit();
      if (reply.ok) setEntries(reply.entries);
      else setStatus(reply.message);
    } catch {
      setStatus(UNREACHABLE);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function undo(entry: AuditEntry) {
    setBusy(true);
    setStatus(undefined);
    try {
      const reply = await api.undo(entry.id);
      if (!reply.ok) setStatus(reply.message);
      else if (reply.result.ok) setStatus(`Undid ${entry.capability}.`);
      else setStatus(reply.result.message);
    } catch {
      setStatus(UNREACHABLE);
    }
    await load();
    setBusy(false);
  }

  return (
    <section className="panel" aria-label="Log">
      <div className="panel-bar">
        <h2>Log</h2>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {status && (
        <p className="panel-status" role="status">
          {status}
        </p>
      )}
      {entries.length === 0 ? (
        <p className="panel-empty">No calls yet.</p>
      ) : (
        <table className="panel-table">
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Capability</th>
              <th scope="col">On</th>
              <th scope="col">Outcome</th>
              <th scope="col">Approved by</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id} className={entry.outcome === "ok" ? undefined : "row-failed"}>
                <td>{timeLabel(entry.time)}</td>
                <td>{entry.capability}</td>
                <td className="cell-scope">{entry.scope ? scopeLabel(entry.scope) : "—"}</td>
                <td>{entry.outcome}</td>
                <td>{APPROVERS[entry.approver]}</td>
                <td>
                  {entry.undone ? (
                    <span className="muted">Undone</span>
                  ) : entry.undoable ? (
                    <button
                      type="button"
                      onClick={() => void undo(entry)}
                      disabled={busy}
                      aria-label={`Undo ${entry.capability} #${entry.id}`}
                    >
                      Undo
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
