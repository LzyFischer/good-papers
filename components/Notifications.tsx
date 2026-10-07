"use client";
// Bell in the header: replies to your comments (from readers or the AI panel) since you
// last opened it. "Last opened" is remembered in this browser.
import Link from "next/link";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase";
import { useSession } from "./AuthButton";

type Reply = { id: string; paper_id: string; author_kind: "user" | "ai"; author_name: string | null; body: string; created_at: string; paper_title: string };

const seenKey = (uid: string) => `gp-replies-seen-${uid}`;

export function Notifications() {
  const { session } = useSession();
  const [replies, setReplies] = useState<Reply[]>([]);
  const [seen, setSeen] = useState<string>("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!session) return;
    try {
      setSeen(localStorage.getItem(seenKey(session.user.id)) ?? "");
    } catch {
      /* storage blocked: everything counts as new */
    }
    browserClient()
      .from("my_replies")
      .select("id, paper_id, author_kind, author_name, body, created_at, paper_title")
      .order("created_at", { ascending: false })
      .limit(15)
      .then(({ data }) => setReplies((data ?? []) as Reply[]));
  }, [session]);

  if (!session) return null;
  const unread = replies.filter((r) => r.created_at > seen).length;

  function toggle() {
    setOpen((o) => !o);
    if (!open && replies[0]) {
      try {
        localStorage.setItem(seenKey(session!.user.id), replies[0].created_at);
      } catch {
        /* ignore */
      }
    }
  }

  return (
    <span className="bell">
      <button className="bell-btn" onClick={toggle} aria-expanded={open} aria-label={`Replies to your comments${unread ? `, ${unread} new` : ""}`}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && <span className="bell-dot">{unread}</span>}
      </button>
      {open && (
        <span className="bell-menu" role="menu">
          {replies.length === 0 ? (
            <span className="bell-empty">No replies yet. Comment on a paper and replies show up here.</span>
          ) : (
            replies.map((r) => (
              <Link key={r.id} role="menuitem" href={`/paper/${r.paper_id}#discussion`} className={r.created_at > seen ? "bell-item bell-item--new" : "bell-item"} onClick={() => setOpen(false)}>
                <b>{r.author_name ?? "A reader"}</b>
                {r.author_kind === "ai" && <span className="ai-badge">AI</span>} replied on <i>{r.paper_title}</i>
                <span className="bell-body">{r.body.length > 110 ? `${r.body.slice(0, 110)}…` : r.body}</span>
              </Link>
            ))
          )}
        </span>
      )}
    </span>
  );
}
