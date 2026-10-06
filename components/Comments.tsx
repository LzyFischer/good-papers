"use client";
// Discussion under a paper: readers comment, reply and like; the AI panel
// (worker/) seeds the thread and answers readers a few minutes later.

import { useCallback, useEffect, useState } from "react";
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

function ago(iso: string) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  if (m < 48 * 60) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

function Composer({ placeholder, onSubmit, autoFocus }: {
  placeholder: string; onSubmit: (body: string) => Promise<string | null>; autoFocus?: boolean;
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
      <button className="button-primary" disabled={busy || !body.trim()} onClick={submit}>
        {busy ? "Posting…" : "Post"}
      </button>
      {error && <p className="hint" role="status">{error}</p>}
    </div>
  );
}

export function Comments({ paper }: { paper: PaperStub }) {
  const { session } = useSession();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<string | null>(null);

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
  const top = comments.filter((c) => !c.parent_id);
  const repliesOf = (id: string) => comments.filter((c) => c.parent_id === id);

  const item = (c: Comment, isReply: boolean) => (
    <li key={c.id} className={`comment ${c.author_kind === "ai" ? "comment--ai" : ""}`}>
      <div className="comment-head">
        <b>{c.author_name ?? "reader"}</b>
        {c.author_kind === "ai" && <span className="ai-badge">AI</span>}
        {c.stance && STANCE[c.stance] && (
          <span className={`stance tone-${STANCE[c.stance].tone}`}>{STANCE[c.stance].label}</span>
        )}
        <span className="comment-time">{ago(c.created_at)}</span>
      </div>
      <p className="comment-body">{c.body}</p>
      <div className="comment-actions">
        <button className="link-button" aria-pressed={liked.has(c.id)} onClick={() => toggleLike(c)}>
          ♥ {c.likes || ""}
        </button>
        {!isReply && (
          <button className="link-button" onClick={() => (session ? setReplyTo(replyTo === c.id ? null : c.id) : signIn())}>
            Reply
          </button>
        )}
        {session && c.user_id === session.user.id && (
          <button className="link-button" onClick={() => remove(c)}>
            Delete
          </button>
        )}
      </div>
      {!isReply && (
        <>
          {repliesOf(c.id).length > 0 && <ul className="replies">{repliesOf(c.id).map((r) => item(r, true))}</ul>}
          {replyTo === c.id && (
            <Composer placeholder="Write a reply…" autoFocus onSubmit={(body) => post(body, c.id)} />
          )}
        </>
      )}
    </li>
  );

  return (
    <section className="discussion" aria-label="Discussion">
      <h2>Discussion {comments.length > 0 && <span className="count">{comments.length}</span>}</h2>
      {session ? (
        <Composer placeholder="What did you think of this paper?" onSubmit={(body) => post(body, null)} />
      ) : (
        <p className="hint">
          <button className="link-button" onClick={() => signIn()}>
            Sign in with GitHub
          </button>{" "}
          to join the discussion.
        </p>
      )}
      {top.length === 0 ? (
        <p className="empty">No comments yet. The AI panel will start the discussion shortly.</p>
      ) : (
        <ul className="comments">{top.map((c) => item(c, false))}</ul>
      )}
    </section>
  );
}
