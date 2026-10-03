// @vitest-environment jsdom
import type { AuditEntry, AuditListReply, TotumApi } from "@totum/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LogPanel } from "./LogPanel.js";

afterEach(cleanup);

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: 1,
    time: "2026-10-03T10:00:00.000Z",
    taskId: "task-1",
    capability: "test.echo",
    tier: 0,
    scope: { kind: "app", app: "totum-test" },
    input: "{}",
    outcome: "ok",
    approver: "grant",
    untrusted: false,
    undoable: false,
    undone: false,
    ...overrides,
  };
}

function setup(entries: AuditEntry[], overrides: Partial<Pick<TotumApi, "listAudit" | "undo">> = {}) {
  const api = {
    listAudit: vi.fn(async (): Promise<AuditListReply> => ({ ok: true, entries })),
    undo: vi.fn<TotumApi["undo"]>(async () => ({ ok: true, result: { ok: true, output: null, untrusted: false } })),
    ...overrides,
  };
  render(<LogPanel api={api} />);
  return { api };
}

const rows = () => screen.getAllByRole("row").slice(1);

describe("LogPanel", () => {
  it("shows every call: capability, scope, outcome and approver", async () => {
    setup([
      entry({ id: 3, capability: "test.danger", tier: 2, outcome: "rejected", approver: "none" }),
      entry({ id: 2, capability: "test.note", scope: { kind: "folder", path: "C:\\Notes" }, approver: "user" }),
      entry({ id: 1, capability: "nope.nothing", tier: null, scope: null, outcome: "unknown_capability", approver: "none" }),
    ]);
    await waitFor(() => expect(rows()).toHaveLength(3));
    const cells = rows().map((r) => within(r).getAllByRole("cell").slice(1, 5).map((c) => c.textContent));
    expect(cells).toEqual([
      ["test.danger", "App totum-test", "rejected", "Nobody"],
      ["test.note", "Folder C:\\Notes", "ok", "You"],
      ["nope.nothing", "—", "unknown_capability", "Nobody"],
    ]);
  });

  it("offers Undo only on undoable rows and marks undone ones", async () => {
    setup([
      entry({ id: 3, capability: "test.note", tier: 1, undoable: true }),
      entry({ id: 2, capability: "test.note", tier: 1, undone: true }),
      entry({ id: 1 }),
    ]);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getAllByRole("button", { name: /^Undo/ })).toHaveLength(1);
    expect(within(rows()[0]!).getByRole("button", { name: "Undo test.note #3" })).toBeTruthy();
    expect(within(rows()[1]!).getByText("Undone")).toBeTruthy();
  });

  it("undoes by entry id, reports it and reloads", async () => {
    const { api } = setup([entry({ id: 7, capability: "test.note", tier: 1, undoable: true })]);
    fireEvent.click(await screen.findByRole("button", { name: "Undo test.note #7" }));
    expect(api.undo).toHaveBeenCalledWith(7);
    expect((await screen.findByRole("status")).textContent).toBe("Undid test.note.");
    expect(api.listAudit).toHaveBeenCalledTimes(2);
  });

  it("shows why an undo was refused", async () => {
    setup([entry({ capability: "test.note", tier: 1, undoable: true })], {
      undo: async () => ({
        ok: true,
        result: { ok: false, code: "undo_failed", message: "The note changed since; not undone." },
      }),
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Undo/ }));
    expect((await screen.findByRole("status")).textContent).toBe("The note changed since; not undone.");
  });

  it("shows an error when the log can't be loaded", async () => {
    setup([], { listAudit: async () => ({ ok: false, code: "host_unavailable", message: "Host isn't running." }) });
    expect((await screen.findByRole("status")).textContent).toBe("Host isn't running.");
  });

  it("reloads on Refresh", async () => {
    const { api } = setup([]);
    await screen.findByText("No calls yet.");
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(api.listAudit).toHaveBeenCalledTimes(2));
  });

  it("shows hostile capability and scope text literally", async () => {
    const text = '<img src=x onerror="window.pwned=1">';
    setup([entry({ capability: text, scope: { kind: "folder", path: text }, outcome: "x" })]);
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(screen.getByText(text).children).toHaveLength(0);
    expect(document.querySelector("img")).toBeNull();
  });
});
