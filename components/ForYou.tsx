"use client";
// "For you": ranked on the server (/api/for-you, lib/forYou.ts). The last list is kept in
// the browser and shown at once; the fresh one replaces it when it arrives.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ForYou as ForYouList } from "@/lib/forYou";
import { browserClient } from "@/lib/supabase";
import { signIn, useSession } from "./AuthButton";
import { clearHistory, readHistory } from "./guestHistory";
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
// Visitors who aren't signed in get one once they've opened this many papers.
export const GUEST_MIN_PAPERS = 2;

// Papers opened before signing in become part of the account's reading history.
async function moveHistoryIntoAccount() {
  const history = readHistory().slice(0, 30);
  if (!history.length) return;
  const db = browserClient();
  await Promise.all(history.map((h) => db.rpc("bump_view", { p_paper: h.id, p_seconds: Math.min(60, Math.max(10, Math.round(h.s))) })));
  clearHistory();
}

export function useForYou(limit: number): { list: ForYouList | null; fresh: boolean; guest: boolean } {
  const { session, ready } = useSession();
  const router = useRouter();
  const [list, setList] = useState<ForYouList | null>(null);
  const [fresh, setFresh] = useState(false);
  const uid = session?.user.id;
  const token = session?.access_token;

  useEffect(() => {
    if (!ready) return;
    const who = uid ?? "guest";
    const history = uid ? [] : readHistory();
    if (!uid && history.length < GUEST_MIN_PAPERS) return;
    setList(cached(who, limit));
    let live = true;
    const request = uid
      ? moveHistoryIntoAccount().then(() => fetch(`/api/for-you?limit=${limit}`, { headers: { Authorization: `Bearer ${token}` } }))
      : fetch("/api/for-you/guest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ papers: history, limit }) });
    request
      .then((r) => (r.ok ? (r.json() as Promise<ForYouList>) : null))
      .then((r) => {
        if (!live || !r) return;
        setList(r);
        setFresh(true);
        try {
          localStorage.setItem(cacheKey(who, limit), JSON.stringify({ at: Date.now(), list: r }));
        } catch {}
        if (rememberTopics(r.topics)) router.refresh();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // The token refreshes every hour; a new one needn't refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, uid, limit, router]);
  return { list, fresh, guest: !uid };
}

export function ForYou() {
  const { list, guest } = useForYou(24);
  if (!list) return null;
  const { papers, reasons, hasTopics } = list;
  if (guest) {
    if (!papers.length) return null;
    return (
      <Shelf
        id="for-you"
        title="For you"
        note="Picked from the papers you've opened on this browser"
        papers={papers}
        reasons={reasons}
      >
        <button className="shelf-more link-button" onClick={() => signIn()}>Sign in to keep it</button>
      </Shelf>
    );
  }
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
