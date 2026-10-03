// Test helper: a window.totum with harmless defaults; override what a test needs
// (pass vi.fn() spies from the test itself).
import type { TotumApi } from "@totum/shared";

export function fakeApi(overrides: Partial<TotumApi> = {}): TotumApi {
  return {
    sendMessage: async () => ({ ok: true, text: "" }),
    onPermissionAsk: () => () => {},
    onPermissionClosed: () => () => {},
    answerPermission: async () => ({ ok: true }),
    listAudit: async () => ({ ok: true, entries: [] }),
    undo: async () => ({ ok: true, result: { ok: true, output: null, untrusted: false } }),
    listGrants: async () => ({ ok: true, grants: [] }),
    revokeGrant: async () => ({ ok: true }),
    ...overrides,
  };
}

/** Permission events a test can fire by hand, as main would through the preload. */
export function fakeAskEvents() {
  const asks = new Set<(payload: unknown) => void>();
  const closed = new Set<(payload: unknown) => void>();
  const on = (set: Set<(payload: unknown) => void>) => (listener: (payload: unknown) => void) => {
    set.add(listener);
    return () => void set.delete(listener);
  };
  return {
    api: { onPermissionAsk: on(asks), onPermissionClosed: on(closed) } satisfies Partial<TotumApi>,
    ask: (payload: unknown) => asks.forEach((l) => l(payload)),
    close: (payload: unknown) => closed.forEach((l) => l(payload)),
    listeners: () => asks.size + closed.size,
  };
}
