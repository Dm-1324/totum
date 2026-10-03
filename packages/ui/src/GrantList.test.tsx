// @vitest-environment jsdom
import type { Grant, GrantsListReply, TotumApi } from "@totum/shared";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GrantList } from "./GrantList.js";

afterEach(cleanup);

function setup(initial: Grant[], overrides: Partial<Pick<TotumApi, "listGrants" | "revokeGrant">> = {}) {
  let grants = initial;
  const api = {
    listGrants: vi.fn(async (): Promise<GrantsListReply> => ({ ok: true, grants })),
    revokeGrant: vi.fn<TotumApi["revokeGrant"]>(async (capability) => {
      grants = grants.filter((g) => g.capability !== capability);
      return { ok: true };
    }),
    ...overrides,
  };
  render(<GrantList api={api} />);
  return { api };
}

const folder = { kind: "folder", path: "C:\\Users\\me\\Documents" } as const;
const rows = () => screen.getAllByRole("row").slice(1);

describe("GrantList", () => {
  it("lists each grant with its scope and lifetime", async () => {
    setup([
      { capability: "test.note", scope: folder, lifetime: "always" },
      { capability: "test.danger", scope: { kind: "app", app: "totum-test" }, lifetime: "session" },
    ]);
    await waitFor(() => expect(rows()).toHaveLength(2));
    const cells = rows().map((r) => within(r).getAllByRole("cell").slice(0, 3).map((c) => c.textContent));
    expect(cells).toEqual([
      ["test.note", "Folder C:\\Users\\me\\Documents", "Always"],
      ["test.danger", "App totum-test", "This session"],
    ]);
  });

  it("revokes the exact capability and scope, then reloads", async () => {
    const { api } = setup([{ capability: "test.note", scope: folder, lifetime: "always" }]);
    fireEvent.click(await screen.findByRole("button", { name: "Revoke test.note on Folder C:\\Users\\me\\Documents" }));
    expect(api.revokeGrant).toHaveBeenCalledWith("test.note", folder);
    await screen.findByText(/No grants/);
    expect(screen.getByRole("status").textContent).toBe("Revoked test.note on Folder C:\\Users\\me\\Documents.");
  });

  it("shows why a revoke failed", async () => {
    setup([{ capability: "test.note", scope: folder, lifetime: "session" }], {
      revokeGrant: async () => ({ ok: false, code: "host_unavailable", message: "Host isn't running." }),
    });
    fireEvent.click(await screen.findByRole("button", { name: /^Revoke/ }));
    expect((await screen.findByRole("status")).textContent).toBe("Host isn't running.");
  });

  it("says when there are no grants", async () => {
    setup([]);
    expect(await screen.findByText("No grants. Totum asks before it touches anything.")).toBeTruthy();
  });

  it("shows a hostile scope literally", async () => {
    const path = "<script>window.pwned=1</script>";
    setup([{ capability: "test.note", scope: { kind: "folder", path }, lifetime: "session" }]);
    expect((await screen.findByText(`Folder ${path}`)).children).toHaveLength(0);
    expect(document.querySelector("script")).toBeNull();
  });
});
