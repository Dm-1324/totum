import type { Grant, TotumApi } from "@totum/shared";
import { useCallback, useEffect, useState } from "react";
import { lifetimeLabel, scopeLabel } from "./format.js";

const UNREACHABLE = "Couldn't reach Totum. Try again, or restart Totum if this keeps happening.";

/** What each capability may touch without asking, and for how long. Revoke takes effect on the next call. */
export function GrantList({ api }: { api: Pick<TotumApi, "listGrants" | "revokeGrant"> }) {
  const [grants, setGrants] = useState<readonly Grant[]>([]);
  const [status, setStatus] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const reply = await api.listGrants();
      if (reply.ok) setGrants(reply.grants);
      else setStatus(reply.message);
    } catch {
      setStatus(UNREACHABLE);
    }
  }, [api]);

  useEffect(() => {
    void load();
  }, [load]);

  async function revoke(grant: Grant) {
    setBusy(true);
    setStatus(undefined);
    try {
      const reply = await api.revokeGrant(grant.capability, grant.scope);
      setStatus(reply.ok ? `Revoked ${grant.capability} on ${scopeLabel(grant.scope)}.` : reply.message);
    } catch {
      setStatus(UNREACHABLE);
    }
    await load();
    setBusy(false);
  }

  return (
    <section className="panel" aria-label="Grants">
      <div className="panel-bar">
        <h2>Grants</h2>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {status && (
        <p className="panel-status" role="status">
          {status}
        </p>
      )}
      {grants.length === 0 ? (
        <p className="panel-empty">No grants. Totum asks before it touches anything.</p>
      ) : (
        <table className="panel-table">
          <thead>
            <tr>
              <th scope="col">Capability</th>
              <th scope="col">On</th>
              <th scope="col">Lasts</th>
              <th scope="col">
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {grants.map((grant) => {
              const label = `${grant.capability} on ${scopeLabel(grant.scope)}`;
              return (
                <tr key={`${grant.lifetime} ${label}`}>
                  <td>{grant.capability}</td>
                  <td className="cell-scope">{scopeLabel(grant.scope)}</td>
                  <td>{lifetimeLabel(grant.lifetime)}</td>
                  <td>
                    <button
                      type="button"
                      onClick={() => void revoke(grant)}
                      disabled={busy}
                      aria-label={`Revoke ${label}`}
                    >
                      Revoke
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}
