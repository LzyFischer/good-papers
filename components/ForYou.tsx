"use client";
// "For you": what's hot right now, tilted toward the topics the reader follows. Each paper
// is ranked in lib/forYou.ts.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { rankForYou, type ForYou as ForYouList } from "@/lib/forYou";
import { browserClient } from "@/lib/supabase";
import type { Score } from "@/lib/types";
import { useSession } from "./AuthButton";
import { getMyVotes } from "./myVotes";
import { getPrefs } from "./prefs";
import { Shelf } from "./Shelf";
import { rememberTopics } from "./topicsCookie";

// The ranked list, shared by the home shelf and the full For you page.
export async function loadForYou(uid: string, limit: number): Promise<ForYouList> {
  const [prefs, votes] = await Promise.all([getPrefs(uid), getMyVotes(uid)]);
  return rankForYou(browserClient(), uid, limit, { prefs, voted: new Set(votes.keys()) });
}

export function ForYou() {
  const { session } = useSession();
  const router = useRouter();
  const [papers, setPapers] = useState<Score[] | null>(null);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [hasTopics, setHasTopics] = useState(false);

  useEffect(() => {
    if (!session) return;
    loadForYou(session.user.id, 24).then((r) => {
      setHasTopics(r.hasTopics);
      setPapers(r.papers);
      setReasons(r.reasons);
      if (rememberTopics(r.topics)) router.refresh();
    });
  }, [session, router]);

  if (!session || papers === null) return null;
  if (!hasTopics) {
    return (
      <section className="shelf foryou-empty" aria-label="For you">
        <div className="shelf-head">
          <div>
            <h2>For you</h2>
            <p className="shelf-note">Pick the areas you follow, or vote on and read a few papers, and your picks show up here.</p>
          </div>
          <Link href="/welcome?edit=1&next=/" className="shelf-more">Pick topics</Link>
        </div>
      </section>
    );
  }
  return (
    <Shelf
      id="for-you"
      title="For you"
      note="Your topics first, then papers like the ones you read"
      papers={papers}
      reasons={reasons}
      more={{ href: "/for-you", label: "See all" }}
    />
  );
}
