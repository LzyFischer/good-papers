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
    router.refresh();
  }

  const voted = vote !== undefined;
  const shown = voted || Boolean(reveal?.open); // the Trending teaser shows the split to everyone
  const pct = reveal?.readerTotal ? Math.round((reveal.readerFresh / reveal.readerTotal) * 100) : null;

  if (compact) {
    return (
      <div className="vote vote--compact" title={error ?? "Only vote on papers you've read"}>
        <button className="vbtn f" aria-pressed={vote === true} aria-label="Upvote: worth reading" disabled={busy} onClick={() => cast(true)}>
          <Icon name="up" />
          <span>Worth reading</span>
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
          <span className="sc-sub">
            {!reveal.readerTotal
              ? "No votes yet. Read it? Be the first."
              : !shown
                ? `${reveal.readerTotal} reader${reveal.readerTotal === 1 ? "" : "s"} voted. Vote to see how they split.`
                : `${reveal.readerFresh} of ${reveal.readerTotal} upvoted`}
            {shown && reveal.coi ? ` · ${reveal.coi} from authors or colleagues not counted` : ""}
          </span>
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
        Only vote on papers you&apos;ve read.{!session && " Sign in with GitHub to vote."}
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
  const same = vote ? reveal.readerFresh : reveal.readerTotal - reveal.readerFresh;
  const others = reveal.readerTotal - 1; // your own vote is in the count
  const aiSame = vote ? reveal.aiYes : reveal.aiTotal - reveal.aiYes;
  return (
    (others > 0 || reveal.aiTotal > 0) && (
      <p className="reveal">
        {others > 0 && `${Math.round(((same - 1) / others) * 100)}% of other readers agree with you. `}
        {reveal.aiTotal > 0 && `${aiSame} of ${reveal.aiTotal} AI reviewers ${others > 0 ? "do too" : "agree with you"}.`}
      </p>
    )
  );
}
