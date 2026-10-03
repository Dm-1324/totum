import { MAX_TEXT_LENGTH, type TotumApi } from "@totum/shared";
import { useRef, useState, type FormEvent } from "react";

type From = "you" | "agent" | "error";

interface Entry {
  id: number;
  from: From;
  text: string;
}

const LABELS: Record<From, string> = { you: "You", agent: "Totum", error: "Error" };

/**
 * The conversation: a transcript and an input. Every piece of text, including
 * the agent's, is rendered as a React text node, never as HTML.
 */
export function App({ api }: { api: TotumApi }) {
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
    <main className="app">
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
