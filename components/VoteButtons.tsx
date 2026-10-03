"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { browserClient } from "@/lib/supabase";
import { signIn, useSession } from "./AuthButton";
import { Icon } from "./Icons";
import { getMyVotes, setMyVote } from "./myVotes";

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
  const [vote, setVote] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!session) {
      setVote(null);
      return;
    }
    getMyVotes(session.user.id).then((m) => setVote(m.has(paper.id) ? m.get(paper.id)! : null));
  }, [session, paper.id]);

  async function cast(choice: boolean) {
    if (!session) {
      signIn();
      return;
    }
    const next = vote === choice ? null : choice;
    const supabase = browserClient();
    setBusy(true);
    setError(null);

    let err = null;
    if (next === null) {
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
        <button className="vbtn f" aria-pressed={vote === true} disabled={busy} onClick={() => cast(true)}>
          <Icon name="fresh" />
          <span>
            Fresh<small>Worth reading</small>
          </span>
        </button>
        <button className="vbtn r" aria-pressed={vote === false} disabled={busy} onClick={() => cast(false)}>
          <Icon name="rotten" />
          <span>
            Rotten<small>Skip it</small>
          </span>
        </button>
      </div>
      {!session && <p className="hint">Sign in with GitHub to vote.</p>}
      {error && (
        <p className="hint" role="status">
          {error}
        </p>
      )}
    </div>
  );
}
