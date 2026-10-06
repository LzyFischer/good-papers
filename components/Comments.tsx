"use client";
// Discussion under a paper: readers comment, reply to anyone at any depth and
// like; the AI panel (worker/) opens the thread, debates itself in nested
// chains, and answers readers a few minutes later.

import { useCallback, useEffect, useMemo, useState } from "react";
import { browserClient } from "@/lib/supabase";
import { signIn, useSession } from "./AuthButton";
import type { PaperStub } from "./VoteButtons";

type Comment = {
  id: string;
  parent_id: string | null;
  author_kind: "user" | "ai";
  user_id: string | null;
  author_name: string | null;
  body: string;
  stance: keyof typeof STANCE | null;
  created_at: string;
  likes: number;
  replies: number;
};

// Jev's graded read of each comment, worded so the low end stays polite.
const STANCE = {
  love: { label: "Big fan", tone: 5 },
  like: { label: "Positive", tone: 4 },
  mixed: { label: "Mixed", tone: 3 },
  doubt: { label: "Skeptical", tone: 2 },
  critical: { label: "Not convinced", tone: 1 },
} as const;

const MAX_INDENT = 5; // deeper replies stop indenting and say who they answer

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

// A stable color per name, so each voice is recognizable across the thread.
function hue(name: string) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
}

function Avatar({ name, ai }: { name: string; ai: boolean }) {
  const initials = name.replace(/[^a-zA-Z0-9]+/g, " ").trim().split(" ").slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";
  return (
    <span className={`avatar ${ai ? "avatar--ai" : ""}`} style={{ ["--h" as string]: hue(name) }} aria-hidden="true">
      {initials}
    </span>
  );
}

function Composer({ placeholder, onSubmit, onCancel, autoFocus }: {
  placeholder: string; onSubmit: (body: string) => Promise<string | null>; onCancel?: () => void; autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!body.trim()) return;
    setBusy(true);
    const err = await onSubmit(body.trim());
    setBusy(false);
    if (err) setError(err);
    else {
      setBody("");
      setError(null);
    }
  }
  return (
    <div className="composer">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder={placeholder}
        rows={3}
        maxLength={2000}
        autoFocus={autoFocus}
      />
      <div className="composer-actions">
        <button className="button-primary" disabled={busy || !body.trim()} onClick={submit}>
          {busy ? "Posting…" : "Post"}
        </button>
        {onCancel && (
          <button className="link-button" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
      {error && <p className="hint" role="status">{error}</p>}
    </div>
  );
}

export function Comments({ paper }: { paper: PaperStub }) {
  const { session } = useSession();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    const supabase = browserClient();
    const { data } = await supabase
      .from("comment_feed")
      .select("id, parent_id, author_kind, user_id, author_name, body, stance, created_at, likes, replies")
      .eq("paper_id", paper.id)
      .order("created_at", { ascending: true });
    const list = (data ?? []) as Comment[];
    setComments(list);
    if (session && list.length) {
      const { data: mine } = await supabase
        .from("comment_likes")
        .select("comment_id")
        .eq("user_id", session.user.id)
        .in("comment_id", list.map((c) => c.id));
      setLiked(new Set((mine ?? []).map((r) => r.comment_id as string)));
    }
  }, [paper.id, session]);

  useEffect(() => {
    load();
  }, [load]);

  const { children, byId, people } = useMemo(() => {
    const children = new Map<string | null, Comment[]>();
    const byId = new Map<string, Comment>();
    for (const c of comments ?? []) {
      byId.set(c.id, c);
      const k = c.parent_id && (comments ?? []).some((x) => x.id === c.parent_id) ? c.parent_id : null;
      children.set(k, [...(children.get(k) ?? []), c]);
    }
    // Top level: most liked and most replied first; replies stay in time order.
    children.get(null)?.sort((a, b) => b.likes - a.likes || b.replies - a.replies || a.created_at.localeCompare(b.created_at));
    const people = new Set((comments ?? []).map((c) => c.author_name ?? "reader")).size;
    return { children, byId, people };
  }, [comments]);

  async function post(body: string, parentId: string | null): Promise<string | null> {
    if (!session) {
      signIn();
      return null;
    }
    const supabase = browserClient();
    // The paper may not be stored yet (e.g. opened from search); comments need it.
    await supabase
      .from("papers")
      .upsert({ ...paper, authors: paper.authors.slice(0, 40) }, { onConflict: "id", ignoreDuplicates: true });
    const { error } = await supabase.from("comments").insert({ paper_id: paper.id, parent_id: parentId, body });
    if (error) return `Your comment wasn't posted: ${error.message}`;
    fetch("/api/nudge", { method: "POST" }).catch(() => {}); // wake the AI reviewers
    setReplyTo(null);
    await load();
    return null;
  }

  async function toggleLike(c: Comment) {
    if (!session) return signIn();
    const supabase = browserClient();
    if (liked.has(c.id)) await supabase.from("comment_likes").delete().eq("comment_id", c.id).eq("user_id", session.user.id);
    else await supabase.from("comment_likes").insert({ comment_id: c.id });
    await load();
  }

  async function remove(c: Comment) {
    await browserClient().from("comments").delete().eq("id", c.id);
    await load();
  }

  if (comments === null) return null;
  const top = children.get(null) ?? [];

  const count = (id: string): number => (children.get(id) ?? []).reduce((n, c) => n + 1 + count(c.id), 0);

  const node = (c: Comment, depth: number): React.ReactNode => {
    const kids = children.get(c.id) ?? [];
    const name = c.author_name ?? "reader";
    const parent = c.parent_id ? byId.get(c.parent_id) : null;
    const folded = collapsed.has(c.id);
    return (
      <li key={c.id} className={`comment ${c.author_kind === "ai" ? "comment--ai" : "comment--reader"}`}>
        <div className="comment-row">
          <Avatar name={name} ai={c.author_kind === "ai"} />
          <div className="comment-main">
            <div className="comment-head">
              <b style={{ ["--h" as string]: hue(name) }} className="handle">{name}</b>
              {c.author_kind === "ai" && <span className="ai-badge">AI</span>}
              {c.stance && STANCE[c.stance] && (
                <span className={`stance tone-${STANCE[c.stance].tone}`}>{STANCE[c.stance].label}</span>
              )}
              <span className="comment-time">{ago(c.created_at)}</span>
            </div>
            {depth > MAX_INDENT && parent && <p className="replying">replying to @{parent.author_name ?? "reader"}</p>}
            <p className="comment-body">{c.body}</p>
            <div className="comment-actions">
              <button className="link-button" aria-pressed={liked.has(c.id)} onClick={() => toggleLike(c)}>
                ♥ {c.likes || ""}
              </button>
              <button className="link-button" onClick={() => (session ? setReplyTo(replyTo === c.id ? null : c.id) : signIn())}>
                Reply
              </button>
              {kids.length > 0 && (
                <button
                  className="link-button"
                  onClick={() => setCollapsed((s) => { const n = new Set(s); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
                >
                  {folded ? `Show ${count(c.id)} repl${count(c.id) === 1 ? "y" : "ies"}` : "Hide replies"}
                </button>
              )}
              {session && c.user_id === session.user.id && (
                <button className="link-button" onClick={() => remove(c)}>
                  Delete
                </button>
              )}
            </div>
            {replyTo === c.id && (
              <Composer placeholder={`Reply to @${name}…`} autoFocus onCancel={() => setReplyTo(null)} onSubmit={(body) => post(body, c.id)} />
            )}
          </div>
        </div>
        {kids.length > 0 && !folded && (
          <ul className={depth < MAX_INDENT ? "replies" : "replies replies--flat"}>{kids.map((k) => node(k, depth + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <section className="discussion" aria-label="Discussion" id="discussion">
      <div className="discussion-head">
        <h2>Discussion</h2>
        {comments.length > 0 && (
          <span className="discussion-meta">
            {comments.length} comment{comments.length === 1 ? "" : "s"} · {people} voice{people === 1 ? "" : "s"}
          </span>
        )}
      </div>
      {session ? (
        <Composer placeholder="What did you think of this paper?" onSubmit={(body) => post(body, null)} />
      ) : (
        <p className="hint">
          <button className="link-button link-button--strong" onClick={() => signIn()}>
            Sign in with GitHub
          </button>{" "}
          to join the discussion. The AI reviewers reply within a few minutes.
        </p>
      )}
      {top.length === 0 ? (
        <p className="empty">The AI reviewers are reading this paper. Their discussion shows up here in a couple of minutes.</p>
      ) : (
        <ul className="comments">{top.map((c) => node(c, 0))}</ul>
      )}
    </section>
  );
}
