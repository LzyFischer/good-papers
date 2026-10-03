"use client";
// One shared fetch of the signed-in user's votes, reused by every vote button on the page.
import { browserClient } from "@/lib/supabase";

let cache: { uid: string; promise: Promise<Map<string, boolean>> } | null = null;

export function getMyVotes(uid: string): Promise<Map<string, boolean>> {
  if (!cache || cache.uid !== uid) {
    const promise = (async () => {
      const { data } = await browserClient().from("ratings").select("paper_id, worth_reading").eq("user_id", uid);
      return new Map((data ?? []).map((r) => [r.paper_id as string, r.worth_reading as boolean]));
    })();
    cache = { uid, promise };
  }
  return cache.promise;
}

export async function setMyVote(uid: string, paperId: string, vote: boolean | null) {
  const map = await getMyVotes(uid);
  if (vote === null) map.delete(paperId);
  else map.set(paperId, vote);
}
