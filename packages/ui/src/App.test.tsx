// @vitest-environment jsdom
import type { ChatSendReply, TotumApi } from "@totum/shared";
import { MAX_TEXT_LENGTH } from "@totum/shared";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App.js";
import { fakeApi, fakeAskEvents } from "./fake-api.js";
import { ASK_1, ASK_2, approvalAsk, grantAsk } from "./fixtures.js";
import { watchPermissionAsks } from "./permission-asks.js";

afterEach(cleanup);

function setup(sendMessage: TotumApi["sendMessage"]) {
  const api: TotumApi = fakeApi({ sendMessage: vi.fn(sendMessage) });
  const view = render(<App api={api} asks={watchPermissionAsks(api)} />);
  const input = screen.getByLabelText<HTMLInputElement>("Message");
  const log = screen.getByRole("log", { name: "Conversation" });
  const type = (text: string) => fireEvent.change(input, { target: { value: text } });
  const submit = () => fireEvent.submit(input.closest("form")!);
  return { api, view, input, log, type, submit };
}

const ok = (text: string): Promise<ChatSendReply> => Promise.resolve({ ok: true, text });

describe("App", () => {
  it("sends the message and shows both sides of the conversation", async () => {
    const { api, log, type, submit, input } = setup(() => ok("agent: hello"));
    type("hello");
    submit();
    expect(api.sendMessage).toHaveBeenCalledWith("hello");
    await within(log).findByText("agent: hello");
    expect(within(log).getByText("hello")).toBeTruthy();
    expect(input.value).toBe("");
  });

  it("shows the error message from a failed reply", async () => {
    const { log, type, submit } = setup(() =>
      Promise.resolve({ ok: false, code: "agent_timeout", message: "The agent didn't answer within 10 seconds." }),
    );
    type("hello");
    submit();
    const error = await within(log).findByText("The agent didn't answer within 10 seconds.");
    expect(error.closest("li")?.className).toContain("entry-error");
  });

  it("shows an error if the bridge itself fails", async () => {
    const { log, type, submit } = setup(() => Promise.reject(new Error("ipc broke")));
    type("hello");
    submit();
    await within(log).findByText(/Couldn't reach Totum/);
  });

  it("does not send empty or whitespace-only messages", () => {
    const { api, type, submit } = setup(() => ok("x"));
    submit();
    type("   ");
    submit();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it("does not send a second message while one is pending", async () => {
    let finish: (r: ChatSendReply) => void = () => {};
    const { api, type, submit } = setup(() => new Promise((r) => (finish = r)));
    type("one");
    submit();
    type("two");
    submit();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    finish({ ok: true, text: "agent: one" });
    await screen.findByText("agent: one");
  });

  it("caps input at the boundary's text limit", () => {
    const { input } = setup(() => ok("x"));
    expect(input.maxLength).toBe(MAX_TEXT_LENGTH);
  });
});

describe("App renders agent text as plain text", () => {
  const hostile = [
    '<img src=x onerror="window.pwned=1">',
    "<script>window.pwned=1</script>",
    '<a href="javascript:window.pwned=1">click</a>',
    "<b>bold</b> &amp; <i>italic</i>",
  ];

  it.each(hostile)("shows %s literally and creates no elements from it", async (text) => {
    const { log, type, submit } = setup(() => ok(text));
    type("hi");
    submit();
    const shown = await within(log).findByText(text);
    expect(shown.textContent).toBe(text);
    expect(shown.children).toHaveLength(0);
    expect(log.querySelector("img, script, a, b, i")).toBeNull();
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it("shows hostile text in an error message literally too", async () => {
    const message = '<img src=x onerror="window.pwned=1">';
    const { log, type, submit } = setup(() => Promise.resolve({ ok: false, code: "agent_unavailable", message }));
    type("hi");
    submit();
    const shown = await within(log).findByText(message);
    expect(shown.children).toHaveLength(0);
  });

  it("shows the user's own text literally", async () => {
    const { log, type, submit } = setup(() => ok("ok"));
    type("<img src=x>");
    submit();
    await waitFor(() => expect(within(log).getByText("<img src=x>")).toBeTruthy());
    expect(log.querySelector("img")).toBeNull();
  });
});

describe("App with permission questions", () => {
  function withAsks(overrides: Partial<TotumApi> = {}) {
    const events = fakeAskEvents();
    const answerPermission = vi.fn<TotumApi["answerPermission"]>(async () => ({ ok: true }));
    const api = fakeApi({ ...events.api, answerPermission, ...overrides });
    const asks = watchPermissionAsks(api);
    return { events, api, asks, answerPermission };
  }

  it("shows an ask that arrived before the app rendered", () => {
    const { events, api, asks } = withAsks();
    events.ask(approvalAsk());
    render(<App api={api} asks={asks} />);
    expect(screen.getByRole("alertdialog")).toBeTruthy();
  });

  it("shows one question at a time and the next once answered", async () => {
    const { events, api, asks } = withAsks();
    render(<App api={api} asks={asks} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    act(() => {
      events.ask(grantAsk());
      events.ask(approvalAsk());
    });
    expect(screen.getAllByRole("alertdialog")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Allow test.note?" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Don't allow" }));
    await screen.findByRole("heading", { name: "Run test.danger?" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reject" }));
  });

  it("closes the dialog when main says the question is over", () => {
    const { events, api, asks, answerPermission } = withAsks();
    render(<App api={api} asks={asks} />);
    act(() => events.ask(approvalAsk()));
    act(() => events.close({ id: ASK_2 }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(answerPermission).not.toHaveBeenCalled();
  });

  it("makes the rest of the window inert while a question is open", () => {
    const { events, api, asks } = withAsks();
    const { container } = render(<App api={api} asks={asks} />);
    const app = container.querySelector(".app")!;
    expect(app.hasAttribute("inert")).toBe(false);
    act(() => events.ask(approvalAsk()));
    expect(app.hasAttribute("inert")).toBe(true);
  });

  it("switches to the log and grants and keeps the chat transcript", async () => {
    const { api, asks } = withAsks({ sendMessage: async () => ({ ok: true, text: "agent: hi" }) });
    render(<App api={api} asks={asks} />);
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "hi" } });
    fireEvent.submit(screen.getByLabelText("Message").closest("form")!);
    await screen.findByText("agent: hi");
    fireEvent.click(screen.getByRole("button", { name: "Log" }));
    await screen.findByText("No calls yet.");
    fireEvent.click(screen.getByRole("button", { name: "Grants" }));
    await screen.findByText(/No grants/);
    fireEvent.click(screen.getByRole("button", { name: "Chat" }));
    expect(screen.getByText("agent: hi")).toBeTruthy();
  });
});
