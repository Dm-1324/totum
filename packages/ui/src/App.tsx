import { MAX_TEXT_LENGTH, type TotumApi } from "@totum/shared";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { GrantList } from "./GrantList.js";
import { LogPanel } from "./LogPanel.js";
import type { PermissionAsks } from "./permission-asks.js";
import { PermissionDialog } from "./PermissionDialog.js";

type From = "you" | "agent" | "error";

interface Entry {
  id: number;
  from: From;
  text: string;
}

const LABELS: Record<From, string> = { you: "You", agent: "Totum", error: "Error" };

type View = "chat" | "log" | "grants";
const VIEWS: Record<View, string> = { chat: "Chat", log: "Log", grants: "Grants" };

/**
 * The window: chat, the call log and grants, plus host's permission questions
 * one at a time on top (the rest is inert while one is open). Every piece of
 * text is rendered as a React text node, never as HTML.
 */
export function App({ api, asks }: { api: TotumApi; asks: PermissionAsks }) {
  const [view, setView] = useState<View>("chat");
  const open = useSyncExternalStore(asks.subscribe, asks.current);
  const first = open[0];

  return (
    <>
      <div className="app" inert={first !== undefined}>
        <nav className="tabs" aria-label="Views">
          {(Object.keys(VIEWS) as View[]).map((v) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {VIEWS[v]}
            </button>
          ))}
        </nav>
        {/* Chat stays mounted so its transcript survives a tab switch; the panels reload when shown. */}
        <Chat api={api} hidden={view !== "chat"} />
        {view === "log" && <LogPanel api={api} />}
        {view === "grants" && <GrantList api={api} />}
      </div>
      {first && <PermissionDialog key={first.id} item={first} api={api} onAnswered={asks.remove} />}
    </>
  );
}

/** The conversation: a transcript and an input. */
function Chat({ api, hidden }: { api: TotumApi; hidden: boolean }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const nextId = useRef(0);

  const add = (from: From, text: string) => {
    const id = nextId.current++;
    setEntries((current) => [...current, { id, from, text }]);
  };

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;

    add("you", text);
    setDraft("");
    setSending(true);
    try {
      const reply = await api.sendMessage(text);
      if (reply.ok) add("agent", reply.text);
      else add("error", reply.message);
    } catch {
      add("error", "Couldn't reach Totum. Try again, or restart Totum if this keeps happening.");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="chat" hidden={hidden}>
      <ol className="transcript" role="log" aria-label="Conversation" aria-live="polite">
        {entries.map((entry) => (
          <li key={entry.id} className={`entry entry-${entry.from}`}>
            <span className="entry-from">{LABELS[entry.from]}</span>
            <p className="entry-text">{entry.text}</p>
          </li>
        ))}
      </ol>
      <form className="composer" onSubmit={onSubmit}>
        <input
          aria-label="Message"
          placeholder="Ask Totum…"
          value={draft}
          maxLength={MAX_TEXT_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          autoFocus
        />
        <button type="submit" disabled={sending || !draft.trim()}>
          {sending ? "Sending…" : "Send"}
        </button>
      </form>
    </main>
  );
}
