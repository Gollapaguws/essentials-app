import { useEffect, useRef, useState } from "react";
import "./live-chat.css";

const API = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";
const NAME_KEY = "essentials.liveChatName";
const POLL_MS = 5000;

/** The palette the room actually uses: decks, moves and reactions. */
const EMOJIS = [
  "🔥", "💃", "🕺", "🎧", "🎵", "🎶", "🔊", "🥁",
  "🎤", "💥", "✨", "💫", "🌙", "⚡", "🖤", "❤️",
  "😍", "😂", "😎", "🤯", "🥵", "🫠", "👀", "🙌",
  "👏", "🤝", "🍸", "🥂", "🍾", "🚀", "💯", "🆙",
];

const clock = (iso) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

/**
 * THE ROOM chat, directly under the stream. Polls the public endpoint; the API
 * throttles posting per IP, so the form is the only thing that can fail loudly.
 */
export default function LiveChat() {
  const [messages, setMessages] = useState([]);
  const [name, setName] = useState(() => localStorage.getItem(NAME_KEY) ?? "");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const logRef = useRef(null);
  const bodyRef = useRef(null);

  const load = async (signal) => {
    try {
      const res = await fetch(`${API}/site/chat`, { signal });
      if (!res.ok) return;
      const rows = await res.json();
      if (Array.isArray(rows)) setMessages(rows);
    } catch {
      // A dropped poll is not worth an error banner; the next tick retries.
    }
  };

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const id = setInterval(() => load(controller.signal), POLL_MS);
    return () => {
      controller.abort();
      clearInterval(id);
    };
  }, []);

  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [messages]);

  /** Drop an emoji in at the caret so it does not land at the end of a long message. */
  const addEmoji = (emoji) => {
    const input = bodyRef.current;
    const start = input?.selectionStart ?? body.length;
    const end = input?.selectionEnd ?? body.length;
    setBody((body.slice(0, start) + emoji + body.slice(end)).slice(0, 280));
    requestAnimationFrame(() => {
      if (!input) return;
      const caret = start + emoji.length;
      input.focus();
      input.setSelectionRange(caret, caret);
    });
  };

  const send = async (event) => {
    event.preventDefault();
    if (sending) return;
    setError(null);

    const cleanName = name.trim();
    const cleanBody = body.trim();
    if (cleanName.length < 2) return setError("Pick a name of at least 2 characters.");
    if (!cleanBody) return setError("Type a message first.");

    setSending(true);
    try {
      const res = await fetch(`${API}/site/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: cleanName, body: cleanBody }),
      });
      if (res.status === 429) throw new Error("Slow down — the room allows a few messages a minute.");
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.message ?? "That message did not send.");
      }
      localStorage.setItem(NAME_KEY, cleanName);
      setBody("");
      await load();
    } catch (err) {
      setError(err.message || "That message did not send.");
    } finally {
      setSending(false);
    }
  };

  return (
    <section id="chat" className="noir-sec" style={{ paddingTop: 0 }}>
      <div className="noir-chat">
        <div className="noir-chat-head">
          <span className="noir-micro">OPEN CHANNEL</span>
          <span className="noir-micro">{messages.length ? `${messages.length} IN THE LOG` : "NO MESSAGES YET"}</span>
        </div>

        <div className="noir-chat-log" ref={logRef} aria-live="polite">
          {messages.length === 0 ? (
            <p className="noir-chat-empty">The room is quiet. Say hello.</p>
          ) : (
            messages.map((message) => (
              <p className="noir-chat-line" key={message.id}>
                <span className="noir-chat-time">{clock(message.createdAt)}</span>
                <span className="noir-chat-name">{message.name}</span>
                <span className="noir-chat-body">{message.body}</span>
              </p>
            ))
          )}
        </div>

        <form className="noir-chat-form" onSubmit={send}>
          <input
            className="noir-chat-input noir-chat-namefield"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Your name"
            maxLength={24}
            aria-label="Your name"
          />
          <div
            className="noir-chat-fieldwrap"
            onKeyDown={(e) => {
              if (e.key === "Escape") setEmojiOpen(false);
            }}
          >
            <input
              ref={bodyRef}
              className="noir-chat-input noir-chat-field"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Say something to the room"
              maxLength={280}
              aria-label="Message"
            />
            <button
              type="button"
              className="noir-chat-emoji"
              aria-label="Add an emoji"
              aria-expanded={emojiOpen}
              onClick={() => setEmojiOpen((open) => !open)}
            >
              ☺
            </button>
            {emojiOpen && (
              <div className="noir-chat-emoji-panel" role="group" aria-label="Emoji">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji}
                    type="button"
                    className="noir-chat-emoji-btn"
                    aria-label={`Insert ${emoji}`}
                    onClick={() => addEmoji(emoji)}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}
          </div>
          <button className="noir-btn" type="submit" disabled={sending}>
            {sending ? "SENDING…" : "SEND"}
          </button>
        </form>

        {error && <p className="noir-chat-error">{error}</p>}
        <p className="noir-chat-note">Public room · no account needed · be decent, it stays</p>
      </div>
    </section>
  );
}
