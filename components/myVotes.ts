"use client";
// One shared fetch of the signed-in user's votes, reused by every vote button on the page.
import { browserClient } from "@/lib/supabase";

// true: fresh, false: rotten, null: read it but abstained. Missing from the map: no vote.
export type Vote = boolean | null;

let cache: { uid: string; promise: Promise<Map<string, Vote>> } | null = null;

export function getMyVotes(uid: string): Promise<Map<string, Vote>> {
  if (!cache || cache.uid !== uid) {
    const promise = (async () => {
      const { data } = await browserClient().from("ratings").select("paper_id, worth_reading").eq("user_id", uid);
      return new Map((data ?? []).map((r) => [r.paper_id as string, r.worth_reading as Vote]));
    })();
    cache = { uid, promise };
  }
  return cache.promise;
}

export async function setMyVote(uid: string, paperId: string, vote: Vote | undefined) {
  const map = await getMyVotes(uid);
  if (vote === undefined) map.delete(paperId);
  else map.set(paperId, vote);
}
