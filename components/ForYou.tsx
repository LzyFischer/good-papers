"use client";
// "For you": what's hot right now, tilted toward the topics the reader follows. Each paper
// is ranked by timeliness (Hugging Face upvotes, discussion, how new it is), how well it
// matches the reader's topics and venues, and its score. Papers they've voted on are left out.
import Link from "next/link";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase";
import type { Score } from "@/lib/types";
import { useSession } from "./AuthButton";
import { getMyVotes } from "./myVotes";
import { areaKeys, getPrefs } from "./prefs";
import { Shelf } from "./Shelf";

const DAYS = 21; // "right now"

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
      const [hot, mine, conf, voted] = await Promise.all([
        // What's hot this month in any area: the timely part.
        db.from("paper_scores").select("*").not("score", "is", null).not("area", "is", null).gte("published_on", since)
          .order("hf_upvotes", { ascending: false, nullsFirst: false }).limit(120),
        // Recent papers in the reader's topics, even if nobody is upvoting them yet.
        db.from("paper_scores").select("*").in("area", keys).not("score", "is", null).gte("published_on", since)
          .order("score", { ascending: false }).limit(60),
        // Conference papers have no publication date yet: the venues the reader follows.
        venues.length
          ? db.from("paper_scores").select("*").in("area", keys).not("score", "is", null)
              .or(venues.map((v) => `venue.ilike.${v}*`).join(",")).order("hf_upvotes", { ascending: false, nullsFirst: false }).limit(40)
          : Promise.resolve({ data: [] }),
        getMyVotes(session.user.id),
      ]);
      const all = new Map<string, Score>();
      for (const s of [...((hot.data ?? []) as Score[]), ...((mine.data ?? []) as Score[]), ...((conf.data ?? []) as Score[])]) all.set(s.id, s);
      const fine = new Set(prefs?.areas ?? []);
      const maxHf = Math.max(1, ...[...all.values()].map((s) => s.hf_upvotes ?? 0));
      const now = Date.now();
      const rank = (s: Score) => {
        const age = s.published_on ? (now - Date.parse(s.published_on)) / 86400_000 : 10;
        const timely =
          0.6 * (Math.log1p(s.hf_upvotes ?? 0) / Math.log1p(maxHf)) + 0.25 * Math.max(0, 1 - age / DAYS) + 0.15 * Math.min(1, s.comments / 10);
        // A topic picked by name beats a whole followed group; outside the reader's topics counts little.
        const interest = s.area && fine.has(s.area) ? 1 : s.area && keys.includes(s.area) ? 0.75 : 0;
        const venue = venues.some((v) => s.venue?.startsWith(v)) ? 0.15 : 0;
        return 0.45 * timely + 0.35 * interest + 0.2 * (s.score ?? 0) + venue;
      };
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
  return <Shelf id="for-you" title="For you" note="What's hot right now, picked for the topics you follow" papers={papers} more={edit} />;
}
