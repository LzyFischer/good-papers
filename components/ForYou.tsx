"use client";
// "For you": the best recent papers in the areas the reader follows, venues they follow
// first, papers they've already voted on left out. Only for signed-in readers with topics.
import Link from "next/link";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase";
import type { Score } from "@/lib/types";
import { useSession } from "./AuthButton";
import { getMyVotes } from "./myVotes";
import { areaKeys, getPrefs } from "./prefs";
import { Shelf } from "./Shelf";

const DAYS = 120;

export function ForYou() {
  const { session } = useSession();
  const [papers, setPapers] = useState<Score[] | null>(null);
  const [hasTopics, setHasTopics] = useState(false);

  useEffect(() => {
    if (!session) return;
    (async () => {
      const prefs = await getPrefs(session.user.id);
      const keys = areaKeys(prefs?.areas ?? []);
      setHasTopics(keys.length > 0);
      if (!keys.length) return setPapers([]);
      const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
      const db = browserClient();
      const venues = prefs?.venues ?? [];
      const [recent, conf, voted] = await Promise.all([
        db.from("paper_scores").select("*").in("area", keys).not("score", "is", null).gte("published_on", since)
          .order("score", { ascending: false }).limit(80),
        // Conference papers have no publication date yet; bring in the venues the reader follows.
        venues.length
          ? db.from("paper_scores").select("*").in("area", keys).not("score", "is", null)
              .or(venues.map((v) => `venue.ilike.${v}*`).join(",")).order("score", { ascending: false }).limit(40)
          : Promise.resolve({ data: [] }),
        getMyVotes(session.user.id),
      ]);
      const all = new Map<string, Score>();
      for (const s of [...((recent.data ?? []) as Score[]), ...((conf.data ?? []) as Score[])]) all.set(s.id, s);
      const rank = (s: Score) =>
        (s.score ?? 0) + Math.min(0.1, (s.hf_upvotes ?? 0) / 2000) + (venues.some((v) => s.venue?.startsWith(v)) ? 0.05 : 0);
      setPapers([...all.values()].filter((s) => !voted.has(s.id)).sort((a, b) => rank(b) - rank(a)).slice(0, 24));
    })();
  }, [session]);

  if (!session || papers === null) return null;
  const edit = { href: "/welcome?edit=1&next=/", label: hasTopics ? "Edit topics" : "Pick topics" };
  if (!hasTopics) {
    return (
      <section className="shelf foryou-empty" aria-label="For you">
        <div className="shelf-head">
          <div>
            <h2>For you</h2>
            <p className="shelf-note">Pick the areas you follow and the best new papers in them show up here.</p>
          </div>
          <Link href={edit.href} className="shelf-more">{edit.label}</Link>
        </div>
      </section>
    );
  }
  return <Shelf id="for-you" title="For you" note="The best recent papers in the topics you follow" papers={papers} more={edit} />;
}
