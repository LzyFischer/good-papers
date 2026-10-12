"use client";
// "For you": ranked on the server (/api/for-you, lib/forYou.ts). The last list is kept in
// the browser and shown at once; the fresh one replaces it when it arrives.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ForYou as ForYouList } from "@/lib/forYou";
import { useSession } from "./AuthButton";
import { Shelf } from "./Shelf";
import { rememberTopics } from "./topicsCookie";

export const FOR_YOU_CACHE = "gp_foryou:";
const MAX_AGE = 24 * 3600_000;

const cacheKey = (uid: string, limit: number) => `${FOR_YOU_CACHE}${uid}:${limit}`;

function cached(uid: string, limit: number): ForYouList | null {
  try {
    const hit = JSON.parse(localStorage.getItem(cacheKey(uid, limit)) ?? "null") as { at: number; list: ForYouList } | null;
    return hit && Date.now() - hit.at < MAX_AGE ? hit.list : null;
  } catch {
    return null;
  }
}

// The ranked list, shared by the home shelf and the full For you page: the cached one first,
// then the fresh one. `fresh` turns true once the server has answered.
export function useForYou(limit: number): { list: ForYouList | null; fresh: boolean } {
  const { session } = useSession();
  const router = useRouter();
  const [list, setList] = useState<ForYouList | null>(null);
  const [fresh, setFresh] = useState(false);
  const uid = session?.user.id;
  const token = session?.access_token;

  useEffect(() => {
    if (!uid || !token) return;
    setList(cached(uid, limit));
    let live = true;
    fetch(`/api/for-you?limit=${limit}`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? (r.json() as Promise<ForYouList>) : null))
      .then((r) => {
        if (!live || !r) return;
        setList(r);
        setFresh(true);
        try {
          localStorage.setItem(cacheKey(uid, limit), JSON.stringify({ at: Date.now(), list: r }));
        } catch {}
        if (rememberTopics(r.topics)) router.refresh();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // The token refreshes every hour; a new one needn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, limit, router]);
  return { list, fresh };
}

export function ForYou() {
  const { session } = useSession();
  const { list } = useForYou(24);
  if (!session || !list) return null;
  const { papers, reasons, hasTopics } = list;
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
