// Test data: permission questions as main sends them.
import type { UiPermissionAsk } from "@totum/shared";

/** Ask ids are UUIDs (MessageId). */
export const ASK_1 = "00000000-0000-4000-8000-000000000001";
export const ASK_2 = "00000000-0000-4000-8000-000000000002";

export function grantAsk(overrides: Partial<Extract<UiPermissionAsk["ask"], { kind: "grant" }>> = {}, id = ASK_1) {
  return {
    id,
    ask: {
      kind: "grant",
      taskId: "task-1",
      capability: "test.note",
      tier: 1,
      scope: { kind: "folder", path: "C:\\Users\\me\\Documents" },
      summary: "Writes a note.",
      lifetimes: ["session", "always"],
      shapedByUntrusted: false,
      ...overrides,
    },
  } satisfies UiPermissionAsk;
}

export function approvalAsk(
  overrides: Partial<Extract<UiPermissionAsk["ask"], { kind: "approval" }>> = {},
  id = ASK_2,
) {
  return {
    id,
    ask: {
      kind: "approval",
      taskId: "task-1",
      capability: "test.danger",
      tier: 2,
      scope: { kind: "app", app: "totum-test" },
      action: "Delete every note.",
      shapedByUntrusted: false,
      ...overrides,
    },
  } satisfies UiPermissionAsk;
}
