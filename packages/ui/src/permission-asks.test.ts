import { describe, expect, it, vi } from "vitest";
import { fakeAskEvents } from "./fake-api.js";
import { ASK_1, ASK_2, approvalAsk, grantAsk } from "./fixtures.js";
import { watchPermissionAsks } from "./permission-asks.js";

function setup() {
  const events = fakeAskEvents();
  const asks = watchPermissionAsks(events.api);
  const changed = vi.fn();
  asks.subscribe(changed);
  return { events, asks, changed };
}

describe("watchPermissionAsks", () => {
  it("queues asks oldest first and tells subscribers", () => {
    const { events, asks, changed } = setup();
    events.ask(grantAsk());
    events.ask(approvalAsk());
    expect(asks.current().map((a) => a.id)).toEqual([ASK_1, ASK_2]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("drops payloads that don't match the schema", () => {
    const { events, asks, changed } = setup();
    events.ask({ id: "x", ask: { kind: "approval", capability: "test.danger" } });
    events.ask(null);
    events.ask({ ...grantAsk(), extra: true });
    events.ask(grantAsk({ lifetimes: [] }));
    expect(asks.current()).toEqual([]);
    expect(changed).not.toHaveBeenCalled();
  });

  it("keeps one copy of an ask main shows again after a reload", () => {
    const { events, asks } = setup();
    events.ask(grantAsk());
    events.ask(grantAsk());
    expect(asks.current()).toHaveLength(1);
  });

  it("removes an ask when main says it's over, or when this window answered it", () => {
    const { events, asks } = setup();
    events.ask(grantAsk());
    events.ask(approvalAsk());
    events.close({ id: ASK_1 });
    expect(asks.current().map((a) => a.id)).toEqual([ASK_2]);
    asks.remove(ASK_2);
    expect(asks.current()).toEqual([]);
  });

  it("ignores closes for unknown ids or bad payloads without a change", () => {
    const { events, asks, changed } = setup();
    events.ask(grantAsk());
    const before = asks.current();
    events.close({ id: "nope" });
    events.close(ASK_1);
    expect(asks.current()).toBe(before);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("unsubscribes from the bridge on dispose", () => {
    const { events, asks } = setup();
    expect(events.listeners()).toBe(2);
    asks.dispose();
    expect(events.listeners()).toBe(0);
  });
});
