"use client";
// The owner's feedback inbox: messages from the Contact page, newest first. Opening the page
// marks what's shown as read, which clears the badge in the account menu.
import { useEffect, useState } from "react";
import { signIn, useSession } from "@/components/AuthButton";
import { isAdmin } from "@/lib/admin";

type Item = { id: string; created_at: string; kind: string; body: string; email: string | null; page: string | null; user_id: string | null; read_at: string | null };
const KIND: Record<string, string> = { bug: "Bug", score: "Score", idea: "Idea", other: "Other" };

export default function FeedbackInbox() {
  const { session, ready } = useSession();
  const [items, setItems] = useState<Item[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session || !isAdmin(session.user.id)) return;
    const auth = { Authorization: `Bearer ${session.access_token}` };
    fetch("/api/feedback/inbox", { headers: auth })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("Couldn't load feedback."))))
      .then((j: { items: Item[] }) => {
        setItems(j.items);
        const unread = j.items.filter((x) => !x.read_at).map((x) => x.id);
        if (unread.length)
          fetch("/api/feedback/inbox", { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ read: unread }) })
            .then(() => window.dispatchEvent(new Event("gp-feedback-read")));
      })
      .catch((e) => setError(e.message));
  }, [session]);

  if (!ready) return <main className="wrap page" />;
  if (!session) return (<main className="wrap page"><button className="button-primary" onClick={() => signIn()}>Sign in</button></main>);
  if (!isAdmin(session.user.id)) return (<main className="wrap page"><p className="empty">This page isn&apos;t for you.</p></main>);

  return (
    <main className="wrap page inbox">
      <h1 className="page-title">Feedback</h1>
      {error && <p className="claim-note">{error}</p>}
      {items && items.length === 0 && <p className="empty">No messages yet.</p>}
      <ul className="inbox-list">
        {items?.map((x) => (
          <li key={x.id} className={x.read_at ? "" : "inbox-new"}>
            <div className="inbox-head">
              <span className={`inbox-kind inbox-kind--${x.kind}`}>{KIND[x.kind] ?? x.kind}</span>
              {!x.read_at && <span className="inbox-dot">New</span>}
              <time>{new Date(x.created_at).toLocaleString()}</time>
            </div>
            <p className="inbox-body">{x.body}</p>
            <p className="inbox-meta">
              {x.email ? <>Reply to <b>{x.email}</b></> : "No email left"}
              {x.user_id ? " · signed in" : " · guest"}
              {x.page ? <> · from {x.page}</> : null}
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
