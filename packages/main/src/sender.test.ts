import { describe, expect, it } from "vitest";
import { isTrustedSender, type SenderInfo, type TrustedRenderer } from "./sender.js";

const dev: TrustedRenderer = { webContentsId: 7, url: "http://localhost:5173" };
const built: TrustedRenderer = {
  webContentsId: 7,
  url: "file:///C:/Users/me/Totum/out/renderer/index.html",
};
const from = (url: string | undefined, over: Partial<SenderInfo> = {}): SenderInfo => ({
  webContentsId: 7,
  isMainFrame: true,
  url,
  ...over,
});

describe("isTrustedSender", () => {
  it("accepts our window's main frame on the dev URL", () => {
    expect(isTrustedSender(from("http://localhost:5173/"), dev)).toBe(true);
    expect(isTrustedSender(from("http://localhost:5173/#section"), dev)).toBe(true);
  });

  it("accepts our window's main frame on the built file, ignoring path case", () => {
    expect(isTrustedSender(from(built.url), built)).toBe(true);
    expect(isTrustedSender(from("file:///c:/users/ME/totum/OUT/renderer/index.html"), built)).toBe(true);
  });

  it.each([
    ["another webContents", from("http://localhost:5173/", { webContentsId: 8 })],
    ["an iframe", from("http://localhost:5173/", { isMainFrame: false })],
    ["a missing frame URL", from(undefined)],
    ["an empty URL", from("")],
    ["an unparsable URL", from("not a url")],
    ["another origin", from("https://evil.example/")],
    ["another port", from("http://localhost:5174/")],
    ["another host on the same port", from("http://127.0.0.1:5173/")],
    ["https instead of http", from("https://localhost:5173/")],
    ["another path", from("http://localhost:5173/evil.html")],
    ["a file URL when dev is trusted", from("file:///C:/Users/me/Totum/out/renderer/index.html")],
    ["a data URL", from("data:text/html,<p>hi</p>")],
    ["about:blank", from("about:blank")],
  ])("rejects %s (dev)", (_name, sender) => {
    expect(isTrustedSender(sender, dev)).toBe(false);
  });

  it.each([
    ["another file", from("file:///C:/Users/me/Downloads/index.html")],
    ["a sibling file", from("file:///C:/Users/me/Totum/out/renderer/other.html")],
    ["a UNC share", from("file://server/share/out/renderer/index.html")],
    ["a malformed escape", from("file:///C:/Users/me/Totum/out/renderer/%E0%A4%A.html")],
    ["the dev URL when the build is trusted", from("http://localhost:5173/")],
  ])("rejects %s (built)", (_name, sender) => {
    expect(isTrustedSender(sender, built)).toBe(false);
  });

  it("rejects everything when nothing is trusted yet", () => {
    expect(isTrustedSender(from("http://localhost:5173/"), undefined)).toBe(false);
  });
});
