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
