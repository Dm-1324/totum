/** Who sent an IPC request, as far as main can tell. */
export interface SenderInfo {
  webContentsId: number;
  /** False for iframes, and when the sending frame is already gone. */
  isMainFrame: boolean;
  url: string | undefined;
}

/** The one renderer allowed to call main: our window, showing our page. */
export interface TrustedRenderer {
  webContentsId: number;
  url: string;
}

/**
 * True only for the main frame of our window while it shows our own page.
 * Anything else (another window, an iframe, a page it navigated to) is refused.
 */
export function isTrustedSender(sender: SenderInfo, trusted: TrustedRenderer | undefined): boolean {
  if (!trusted || !sender.url) return false;
  if (sender.webContentsId !== trusted.webContentsId || !sender.isMainFrame) return false;
  return sameDocument(sender.url, trusted.url);
}

function sameDocument(actual: string, expected: string): boolean {
  try {
    const a = new URL(actual);
    const e = new URL(expected);
    if (a.protocol !== e.protocol || a.host !== e.host) return false;
    if (a.protocol === "file:") {
      // Windows paths are case-insensitive; compare decoded, lowercased paths.
      return decodeURIComponent(a.pathname).toLowerCase() === decodeURIComponent(e.pathname).toLowerCase();
    }
    return a.pathname === e.pathname;
  } catch {
    // Unparsable URL or malformed escape: not ours.
    return false;
  }
}
