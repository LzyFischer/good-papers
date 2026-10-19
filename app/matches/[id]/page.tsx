"use client";
// A conversation with one match (app/api/messages). New messages show up by polling while
// the tab is open. Block stops messages both ways; report flags a message for the owner.
import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { signIn, useSession } from "@/components/AuthButton";
import { browserClient } from "@/lib/supabase";

type Message = { id: string; body: string; created_at: string; mine: boolean };
type Thread = { messages: Message[]; canSend: boolean; other: { name: string | null; orcid: string } | null };

const POLL_MS = 8000;

function when(iso: string) {
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export default function Conversation() {
  const { id } = useParams<{ id: string }>();
  const { session, ready } = useSession();
  const [thread, setThread] = useState<Thread | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const token = session?.access_token;

  const load = useCallback(async () => {
    if (!token) return;
    const r = await fetch(`/api/messages?with=${id}`, { headers: { Authorization: `Bearer ${token}` } });
    const j = (await r.json().catch(() => null)) as (Thread & { error?: string }) | null;
    if (!r.ok || !j) return setError(j?.error ?? "Couldn't load the conversation.");
    setError(null);
    setThread((t) => (t && t.messages.length === j.messages.length ? { ...t, canSend: j.canSend } : j));
  }, [id, token]);

  useEffect(() => {
    load();
    const tick = setInterval(() => document.visibilityState === "visible" && load(), POLL_MS);
    return () => clearInterval(tick);
  }, [load]);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [thread?.messages.length]);

  async function send() {
    const body = text.trim();
    if (!body || !token) return;
    setBusy(true);
    const r = await fetch("/api/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: id, body }),
    });
    const j = (await r.json().catch(() => ({}))) as { message?: Message; error?: string };
    setBusy(false);
    if (!j.message) return setError(j.error ?? "Your message wasn't sent.");
    setText("");
    setThread((t) => (t ? { ...t, messages: [...t.messages, j.message!] } : t));
  }

  async function block() {
    if (!session || !confirm("Block this author? You won't match or message each other again.")) return;
    await browserClient().from("match_blocks").insert({ blocker: session.user.id, blocked: id });
    window.location.href = "/matches";
  }

  async function report(m: Message) {
    const reason = prompt("What's wrong with this message? (optional)");
    if (reason === null) return;
    const { error: e } = await browserClient().from("message_reports").insert({ message_id: m.id, reason: reason.slice(0, 500) || null });
    alert(e ? "Couldn't send the report." : "Thanks. We'll take a look.");
  }

  if (!ready) return <main className="wrap page" />;
  if (!session) {
    return (
      <main className="wrap page">
        <p className="empty">Sign in to see your messages.</p>
        <button className="button-primary" onClick={() => signIn()}>Sign in</button>
      </main>
    );
  }

  const name = thread?.other?.name ?? thread?.other?.orcid ?? "Your match";
  return (
    <main className="wrap page chat">
      <div className="chat-head">
        <Link href="/matches" className="chat-back">← Matches</Link>
        <h1 className="chat-name">
          {thread?.other?.orcid ? (
            <a href={`https://orcid.org/${thread.other.orcid}`} target="_blank" rel="noopener noreferrer">{name}</a>
          ) : (
            name
          )}
        </h1>
        <button className="link-button chat-block" onClick={block}>Block</button>
      </div>

      <div className="chat-log" aria-live="polite">
        {thread && thread.messages.length === 0 && (
          <p className="chat-empty">You read each other&apos;s work. Say hello: what caught your eye in their paper?</p>
        )}
        {thread?.messages.map((m) => (
          <div key={m.id} className={`chat-msg ${m.mine ? "chat-msg--mine" : ""}`}>
            <p>{m.body}</p>
            <span className="chat-meta">
              {when(m.created_at)}
              {!m.mine && (
                <button className="link-button" onClick={() => report(m)}>Report</button>
              )}
            </span>
          </div>
        ))}
        <div ref={end} />
      </div>

      {error && <p className="claim-note" role="status">{error}</p>}
      {thread?.canSend ? (
        <div className="chat-compose">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
            placeholder="Write a message…"
            rows={2}
            maxLength={2000}
          />
          <button className="button-primary" onClick={send} disabled={busy || !text.trim()}>Send</button>
        </div>
      ) : thread ? (
        <p className="hint">You&apos;re no longer a match, so you can read this conversation but not reply.</p>
      ) : null}
    </main>
  );
}
