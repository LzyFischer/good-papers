"use client";
// The Contact form: what it's about, the message, an optional email to reply to.
import { useState } from "react";
import { useSession } from "@/components/AuthButton";

const KINDS = [
  { id: "bug", label: "Something's broken" },
  { id: "score", label: "A score looks wrong" },
  { id: "idea", label: "An idea" },
  { id: "other", label: "Something else" },
];

export function ContactForm() {
  const { session } = useSession();
  const [kind, setKind] = useState("idea");
  const [body, setBody] = useState("");
  const [email, setEmail] = useState("");
  const [website, setWebsite] = useState(""); // honeypot
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return setError("Write a message first.");
    setState("sending");
    setError(null);
    const r = await fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(session ? { Authorization: `Bearer ${session.access_token}` } : {}) },
      body: JSON.stringify({ kind, body, email: email || session?.user.email || "", page: document.referrer.slice(0, 300), website }),
    });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!j.ok) {
      setState("idle");
      return setError(j.error ?? "Your message wasn't sent. Try again in a moment.");
    }
    setState("sent");
  }

  if (state === "sent")
    return (
      <div className="contact-sent" role="status">
        <b>Thanks, it&apos;s sent.</b>
        <p>{email || session?.user.email ? "If it needs a reply, you'll hear back by email." : "We read every message."}</p>
        <button className="link-button" onClick={() => { setBody(""); setState("idle"); }}>Send another</button>
      </div>
    );

  return (
    <form className="contact-form" onSubmit={send}>
      <fieldset>
        <legend>What&apos;s it about?</legend>
        <div className="contact-kinds">
          {KINDS.map((k) => (
            <label key={k.id} className={kind === k.id ? "on" : ""}>
              <input type="radio" name="kind" value={k.id} checked={kind === k.id} onChange={() => setKind(k.id)} />
              {k.label}
            </label>
          ))}
        </div>
      </fieldset>
      <label htmlFor="contact-body">Message</label>
      <textarea
        id="contact-body"
        value={body}
        onChange={(e) => { setBody(e.target.value); setError(null); }}
        rows={6}
        maxLength={4000}
        placeholder={kind === "score" ? "Which paper, and what do you think its score should be?" : "Tell us what you think."}
      />
      <label htmlFor="contact-email">
        Email <span>(optional, if you&apos;d like a reply{session?.user.email ? `; we'll use ${session.user.email} if you leave it empty` : ""})</span>
      </label>
      <input id="contact-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@university.edu" maxLength={200} />
      <input className="contact-hp" tabIndex={-1} autoComplete="off" aria-hidden="true" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} />
      {error && <p className="signin-error" role="alert">{error}</p>}
      <button className="button-primary" disabled={state === "sending"}>{state === "sending" ? "Sending…" : "Send"}</button>
    </form>
  );
}
