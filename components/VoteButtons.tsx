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

export function VoteButtons({ paper }: { paper: PaperStub }) {
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

  return (
    <div className="vote-wrap">
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
