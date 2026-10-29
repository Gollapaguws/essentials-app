import { useState } from "react";

const API_URL = import.meta.env.VITE_API_URL ?? "https://essentialsedm.com/api";

export default function SiteFooter() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setStatus("sending");
    setMessage("");
    try {
      const response = await fetch(`${API_URL}/site/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.ok) {
        setStatus("done");
        setEmail("");
        setMessage(data.already ? "You are already on the list." : "You are on the list. Watch your inbox.");
      } else {
        setStatus("error");
        setMessage(data.error || "Something went wrong. Try again.");
      }
    } catch (error) {
      setStatus("error");
      setMessage(error?.response?.data?.error || "Something went wrong. Try again.");
    }
  };

  return (
    <footer id="contact" className="noir-contact">
      <div className="noir-panel">
        <span className="noir-micro">GET THE PULSE</span>
        <h2 className="noir-panel-h2">
          NEVER MISS
          <br />
          A ROOM.
        </h2>

        <form onSubmit={handleSubmit} className="noir-form">
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="YOUR EMAIL"
            aria-label="Your email"
            className="noir-input"
          />
          <button type="submit" disabled={status === "sending"} className="noir-btn">
            {status === "sending" ? "JOINING" : "JOIN →"}
          </button>
        </form>

        <p aria-live="polite" className="noir-msg">
          {message}
        </p>
      </div>

      <div className="noir-foot">
        <span className="noir-micro">© 2026 ESSENTIALS — JOHANNESBURG</span>
        <span className="noir-micro">ALL SOUND. NO FILLER.</span>
      </div>
    </footer>
  );
}