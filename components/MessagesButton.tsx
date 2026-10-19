"use client";
// Chat bubble in the header, next to the bell: conversations with your matches and how many
// messages are unread (app/api/messages/inbox). Checked on load and when the tab comes back.
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "./AuthButton";

type Thread = { with: string; name: string; last: string; at: string; mine: boolean; unread: number };

export function MessagesButton() {
  const { session } = useSession();
  const [threads, setThreads] = useState<Thread[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const token = session?.access_token;

  const load = useCallback(() => {
    if (!token) return;
    fetch("/api/messages/inbox", { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { threads: Thread[]; unread: number } | null) => {
        if (!j) return;
        setThreads(j.threads);
        setUnread(j.unread);
      })
      .catch(() => {});
  }, [token]);

  useEffect(() => {
    load();
    const back = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", back);
    return () => document.removeEventListener("visibilitychange", back);
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!session) return null;
  return (
    <span className="bell" ref={ref}>
      <button className="bell-btn" onClick={() => { setOpen((o) => !o); if (!open) load(); }} aria-expanded={open} aria-label={`Messages${unread ? `, ${unread} unread` : ""}`}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z" />
        </svg>
        {unread > 0 && <span className="bell-dot">{unread}</span>}
      </button>
      {open && (
        <span className="bell-menu" role="menu">
          {threads.length === 0 ? (
            <span className="bell-empty">No messages yet. Authors who voted on each other&apos;s papers can message on Matches.</span>
          ) : (
            threads.map((t) => (
              <Link key={t.with} role="menuitem" href={`/matches/${t.with}`} className={t.unread ? "bell-item bell-item--new" : "bell-item"} onClick={() => setOpen(false)}>
                <i>{t.name}</i>
                {t.unread > 0 && <span className="account-badge">{t.unread}</span>}
                <span className="bell-body">{t.mine ? "You: " : ""}{t.last.length > 90 ? `${t.last.slice(0, 90)}…` : t.last}</span>
              </Link>
            ))
          )}
          <Link role="menuitem" href="/matches" className="bell-item bell-all" onClick={() => setOpen(false)}>All matches →</Link>
        </span>
      )}
    </span>
  );
}
