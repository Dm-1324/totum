import type { PermissionDecision, TotumApi, UiPermissionAsk } from "@totum/shared";
import { useId, useState, type KeyboardEvent } from "react";
import { lifetimeLabel, scopeLabel, tierLabel } from "./format.js";

const UNTRUSTED_NOTE = "This step was suggested by content Totum read, not by you.";

/**
 * One question from host, shown exactly as sent, every string as a text node.
 * The refusing button has focus, so a stray Enter refuses; Escape refuses too.
 * The dialog never answers on its own: only a click (or a key on a focused
 * button) sends a decision. Approval has no Edit yet (milestone 5).
 */
export function PermissionDialog({
  item,
  api,
  onAnswered,
}: {
  item: UiPermissionAsk;
  api: Pick<TotumApi, "answerPermission">;
  /** Called once main has the answer, or says the question is already over. */
  onAnswered: (id: string) => void;
}) {
  const { id, ask } = item;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const titleId = useId();
  const bodyId = useId();

  async function answer(decision: PermissionDecision) {
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      const reply = await api.answerPermission(id, decision);
      if (reply.ok || reply.code === "unknown_ask") {
        onAnswered(id);
        return;
      }
      setError(reply.message);
    } catch {
      setError("Couldn't reach Totum. Try again, or restart Totum if this keeps happening.");
    }
    setBusy(false);
  }

  const refuse = () => void answer({ decision: "deny" });

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      event.preventDefault();
      refuse();
    }
  }

  const title = ask.kind === "grant" ? `Allow ${ask.capability}?` : `Run ${ask.capability}?`;

  return (
    <div className="dialog-backdrop">
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="dialog-title">
          {title}
        </h2>
        <div id={bodyId}>
          {ask.shapedByUntrusted && (
            <p className="dialog-warning" role="note">
              {UNTRUSTED_NOTE}
            </p>
          )}
          <dl className="dialog-facts">
            <dt>Capability</dt>
            <dd>{ask.capability}</dd>
            <dt>Risk</dt>
            <dd>{tierLabel(ask.tier)}</dd>
            <dt>On</dt>
            <dd className="dialog-scope">{scopeLabel(ask.scope)}</dd>
          </dl>
          {ask.kind === "grant" ? (
            <p className="dialog-text">{ask.summary}</p>
          ) : (
            <pre className="dialog-action" aria-label="Action">
              {ask.action}
            </pre>
          )}
        </div>
        {error && (
          <p className="dialog-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-buttons">
          {ask.kind === "grant" ? (
            <>
              <button type="button" onClick={refuse} disabled={busy} autoFocus>
                Don't allow
              </button>
              {ask.lifetimes.map((lifetime) => (
                <button
                  key={lifetime}
                  type="button"
                  className="primary"
                  onClick={() => void answer({ decision: "allow", lifetime })}
                  disabled={busy}
                >
                  {lifetime === "always" ? "Always allow" : `Allow (${lifetimeLabel(lifetime).toLowerCase()})`}
                </button>
              ))}
            </>
          ) : (
            <>
              <button type="button" onClick={refuse} disabled={busy} autoFocus>
                Reject
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => void answer({ decision: "approve" })}
                disabled={busy}
              >
                Approve
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
