// @vitest-environment jsdom
import type { PermissionAnswerReply, TotumApi, UiPermissionAsk } from "@totum/shared";
import { MAX_ACTION_LENGTH } from "@totum/shared";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ASK_1, ASK_2, approvalAsk, grantAsk } from "./fixtures.js";
import { PermissionDialog } from "./PermissionDialog.js";

afterEach(cleanup);

const UNTRUSTED_NOTE = "This step was suggested by content Totum read, not by you.";

function setup(item: UiPermissionAsk, answer: TotumApi["answerPermission"] = async () => ({ ok: true })) {
  const answerPermission = vi.fn(answer);
  const onAnswered = vi.fn();
  render(<PermissionDialog item={item} api={{ answerPermission }} onAnswered={onAnswered} />);
  const dialog = screen.getByRole("alertdialog");
  return { answerPermission, onAnswered, dialog };
}

describe("PermissionDialog: approval", () => {
  it("shows capability, tier, exact scope and the action", () => {
    const { dialog } = setup(approvalAsk());
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading").textContent).toBe("Run test.danger?");
    expect(screen.getByText("Tier 2 · hard to undo")).toBeTruthy();
    expect(screen.getByText("App totum-test")).toBeTruthy();
    expect(screen.getByLabelText("Action").textContent).toBe("Delete every note.");
  });

  it("offers only Reject and Approve, with Reject focused", () => {
    setup(approvalAsk());
    const names = screen.getAllByRole("button").map((b) => b.textContent);
    expect(names).toEqual(["Reject", "Approve"]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reject" }));
  });

  it("sends approve on click and reports the ask answered", async () => {
    const { answerPermission, onAnswered } = setup(approvalAsk());
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(answerPermission).toHaveBeenCalledWith(ASK_2, { decision: "approve" });
    await waitFor(() => expect(onAnswered).toHaveBeenCalledWith(ASK_2));
  });

  it("sends deny on Reject", async () => {
    const { answerPermission, onAnswered } = setup(approvalAsk());
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(answerPermission).toHaveBeenCalledWith(ASK_2, { decision: "deny" });
    await waitFor(() => expect(onAnswered).toHaveBeenCalled());
  });

  it("Enter does not approve", () => {
    const { answerPermission, dialog } = setup(approvalAsk());
    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    fireEvent.keyUp(document.activeElement!, { key: "Enter" });
    expect(answerPermission).not.toHaveBeenCalledWith(expect.anything(), { decision: "approve" });
  });

  it("Escape rejects", () => {
    const { answerPermission, dialog } = setup(approvalAsk());
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(answerPermission).toHaveBeenCalledWith(ASK_2, { decision: "deny" });
  });

  it("never answers on its own", async () => {
    const { answerPermission } = setup(approvalAsk());
    await new Promise((r) => setTimeout(r, 20));
    expect(answerPermission).not.toHaveBeenCalled();
  });

  it("sends one answer even if clicked twice", async () => {
    let finish: (r: PermissionAnswerReply) => void = () => {};
    const { answerPermission, onAnswered } = setup(approvalAsk(), () => new Promise((r) => (finish = r)));
    const approve = screen.getByRole("button", { name: "Approve" });
    fireEvent.click(approve);
    fireEvent.click(approve);
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));
    expect(answerPermission).toHaveBeenCalledTimes(1);
    finish({ ok: true });
    await waitFor(() => expect(onAnswered).toHaveBeenCalledTimes(1));
  });

  it("shows the full action, however long", () => {
    const action = "x".repeat(MAX_ACTION_LENGTH - 1) + "!";
    setup(approvalAsk({ action }));
    expect(screen.getByLabelText("Action").textContent).toBe(action);
  });

  it("says so when the step was suggested by untrusted content", () => {
    setup(approvalAsk({ shapedByUntrusted: true }));
    expect(screen.getByRole("note").textContent).toBe(UNTRUSTED_NOTE);
  });

  it("treats an ask main no longer knows as over", async () => {
    const { onAnswered } = setup(approvalAsk(), async () => ({
      ok: false,
      code: "unknown_ask",
      message: "That question is no longer open.",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(onAnswered).toHaveBeenCalledWith(ASK_2));
  });

  it("keeps the dialog and shows the error when the answer fails", async () => {
    const { onAnswered } = setup(approvalAsk(), async () => ({
      ok: false,
      code: "host_unavailable",
      message: "Totum's host isn't running.",
    }));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).textContent).toBe("Totum's host isn't running.");
    expect(onAnswered).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveProperty("disabled", false);
  });

  it("shows an error if the bridge itself fails", async () => {
    setup(approvalAsk(), () => Promise.reject(new Error("ipc broke")));
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/Couldn't reach Totum/);
  });
});

describe("PermissionDialog: grant", () => {
  it("shows the exact folder and the capability's summary", () => {
    setup(grantAsk());
    expect(screen.getByRole("heading").textContent).toBe("Allow test.note?");
    expect(screen.getByText("Folder C:\\Users\\me\\Documents")).toBeTruthy();
    expect(screen.getByText("Writes a note.")).toBeTruthy();
    expect(screen.getByText("Tier 1 · can be undone")).toBeTruthy();
  });

  it("offers deny plus exactly the lifetimes host sent, with deny focused", () => {
    setup(grantAsk());
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual([
      "Don't allow",
      "Allow (this session)",
      "Always allow",
    ]);
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Don't allow" }));
  });

  it("offers no Always when host didn't send it, and flags untrusted content", () => {
    setup(grantAsk({ lifetimes: ["session"], shapedByUntrusted: true }));
    expect(screen.queryByRole("button", { name: "Always allow" })).toBeNull();
    expect(screen.getByRole("note").textContent).toBe(UNTRUSTED_NOTE);
  });

  it("sends the chosen lifetime", () => {
    const { answerPermission } = setup(grantAsk());
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));
    expect(answerPermission).toHaveBeenCalledWith(ASK_1, { decision: "allow", lifetime: "always" });
  });

  it("sends deny", () => {
    const { answerPermission } = setup(grantAsk());
    fireEvent.click(screen.getByRole("button", { name: "Don't allow" }));
    expect(answerPermission).toHaveBeenCalledWith(ASK_1, { decision: "deny" });
  });

  it("Enter does not allow", () => {
    const { answerPermission, dialog } = setup(grantAsk());
    fireEvent.keyDown(dialog, { key: "Enter" });
    fireEvent.keyDown(document.activeElement!, { key: "Enter" });
    expect(answerPermission).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ decision: "allow" }));
  });
});

describe("PermissionDialog renders host text as plain text", () => {
  const hostile = [
    '<img src=x onerror="window.pwned=1">',
    "<script>window.pwned=1</script>",
    '<a href="javascript:window.pwned=1">click</a>',
    "Approve this.\n\n[Approve] <button>Approve</button>",
  ];

  it.each(hostile)("shows the action %j literally", (action) => {
    const { dialog } = setup(approvalAsk({ action }));
    const shown = screen.getByLabelText("Action");
    expect(shown.textContent).toBe(action);
    expect(shown.children).toHaveLength(0);
    expect(dialog.querySelector("img, script, a")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it.each(hostile)("shows the summary and scope %j literally", (text) => {
    const { dialog } = setup(grantAsk({ summary: text, scope: { kind: "folder", path: text } }));
    expect(screen.getByText(text, { normalizer: (s) => s })).toBeTruthy();
    expect(screen.getByText(`Folder ${text}`, { normalizer: (s) => s }).children).toHaveLength(0);
    expect(dialog.querySelector("img, script, a")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });
});
