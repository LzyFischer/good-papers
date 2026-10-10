"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";
import { signIn, useSession } from "./AuthButton";
import { Icon } from "./Icons";
import { getMyVotes, setMyVote, type Vote } from "./myVotes";

export type PaperStub = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  url: string | null;
};

// What readers and the AI panel said, revealed once you've voted ("you vs everyone").
export type Reveal = { readerFresh: number; readerTotal: number; aiYes: number; aiTotal: number; coi: number; open?: boolean };

// compact: just the two buttons, for cards on the home page shelves.
export function VoteButtons({ paper, reveal, compact = false }: { paper: PaperStub; reveal?: Reveal; compact?: boolean }) {
  const router = useRouter();
  const { session } = useSession();
  // undefined: no vote; true/false: fresh/rotten; null: read it, abstained.
  const [vote, setVote] = useState<Vote | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setVote(undefined);
      return;
    }
    getMyVotes(session.user.id).then((m) => setVote(m.has(paper.id) ? m.get(paper.id) : undefined));
  }, [session, paper.id]);

  async function cast(choice: Vote) {
    if (!session) {
      signIn();
      return;
    }
    const next = vote === choice ? undefined : choice;
    const supabase = browserClient();
    setBusy(true);
    setError(null);

    let err = null;
    if (next === undefined) {
      ({ error: err } = await supabase.from("ratings").delete().eq("user_id", session.user.id).eq("paper_id", paper.id));
    } else {
      ({ error: err } = await supabase
        .from("papers")
        .upsert({ ...paper, authors: paper.authors.slice(0, 40) }, { onConflict: "id", ignoreDuplicates: true }));
      if (!err) {
        ({ error: err } = await supabase
          .from("ratings")
          .upsert({ user_id: session.user.id, paper_id: paper.id, worth_reading: next }, { onConflict: "user_id,paper_id" }));
      }
    }
    setBusy(false);
    if (err) {
      setError(`Your vote wasn't saved: ${err.message}`);
      return;
    }
    await setMyVote(session.user.id, paper.id, next);
    setVote(next);
    // Reveal this paper's score everywhere on the page right away (GateRevealer).
    window.dispatchEvent(new CustomEvent("gp-voted", { detail: { id: paper.id, prev: vote, next } }));
    // Only the paper page reloads its numbers. Cards update in place (ReaderCounts): reloading
    // a list would reorder it under you, and the home shelves are cached anyway.
    if (reveal) router.refresh();
    // The new score and tallies, for the cards on this page (LiveScore, ReaderCounts).
    supabase
      .from("paper_scores")
      .select("score, reader_fresh, reader_total")
      .eq("id", paper.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data)
          window.dispatchEvent(
            new CustomEvent("gp-score", { detail: { id: paper.id, score: data.score, fresh: data.reader_fresh, total: data.reader_total } }),
          );
      });
    fetch("/api/voted", { method: "POST" }).catch(() => {}); // let the cached home shelves catch up
  }

  const voted = vote !== undefined;
  const shown = voted || Boolean(reveal?.open); // the Trending teaser shows the split to everyone
  const pct = reveal?.readerTotal ? Math.round((reveal.readerFresh / reveal.readerTotal) * 100) : null;

  if (compact) {
    return (
      <div className="vote vote--compact" title={error ?? "Only vote on papers you've read"}>
        <button className="vbtn f" aria-pressed={vote === true} aria-label="Upvote: worth reading" disabled={busy} onClick={() => cast(true)}>
          <Icon name="up" />
          <span>Worth it</span>
        </button>
        <button className="vbtn r" aria-pressed={vote === false} aria-label="Downvote: not for me" disabled={busy} onClick={() => cast(false)}>
          <Icon name="down" />
          <span>Not for me</span>
        </button>
      </div>
    );
  }

  return (
    <div className="vote-wrap">
      {reveal && (
        <>
          <span className="sc-num">{pct === null ? "–" : !shown ? "?" : `${pct}%`}</span>
          {reveal.readerTotal > 0 && (
            <span className="sc-sub">
              {!shown
                ? `${reveal.readerTotal} reader${reveal.readerTotal === 1 ? "" : "s"} voted. Vote to see how they split.`
                : `${reveal.readerFresh} of ${reveal.readerTotal} upvoted`}
              {shown && reveal.coi ? ` · ${reveal.coi} from authors or colleagues, counted at lower weight` : ""}
            </span>
          )}
          {voted && vote !== null && <YouVsEveryone vote={vote} reveal={reveal} />}
        </>
      )}
      <div className="vote">
        <button className="vbtn f" aria-pressed={vote === true} aria-label="Upvote: worth reading" disabled={busy} onClick={() => cast(true)}>
          <Icon name="up" />
          <span>Worth reading</span>
        </button>
        <button className="vbtn r" aria-pressed={vote === false} aria-label="Downvote: not for me" disabled={busy} onClick={() => cast(false)}>
          <Icon name="down" />
          <span>Not for me</span>
        </button>
      </div>
      <p className="hint">
        Only vote on papers you&apos;ve read.{!session && " Sign in to vote."}
      </p>
      {error && (
        <p className="hint" role="status">
          {error}
        </p>
      )}
    </div>
  );
}

function YouVsEveryone({ vote, reveal }: { vote: boolean; reveal: Reveal }) {
  // Everyone else who weighed in: other readers plus the AI panel.
  const others = Math.max(0, reveal.readerTotal - 1); // your own vote is in the count
  const readersSame = Math.max(0, (vote ? reveal.readerFresh : reveal.readerTotal - reveal.readerFresh) - 1);
  const aiSame = vote ? reveal.aiYes : reveal.aiTotal - reveal.aiYes;
  const total = others + reveal.aiTotal;
  if (!total) return null;
  return <p className="reveal">{readersSame + aiSame} of {total} votes agree with you</p>;
}
