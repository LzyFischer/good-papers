"use client";
// The signed-in reader's interests (reader_prefs, migration 014), shared by the welcome
// page, the "For you" shelf and the onboarding redirect.
import { browserClient } from "@/lib/supabase";

import type { Prefs } from "@/lib/forYou";

export type { Prefs };
export { areaKeys } from "@/lib/forYou";

export const VENUES = ["NeurIPS", "ICML", "ICLR", "ACL", "EMNLP", "NAACL", "CVPR", "ICCV", "ECCV", "AAAI", "KDD", "COLM", "TMLR"];

let cache: { uid: string; promise: Promise<Prefs | null> } | null = null;

export function getPrefs(uid: string): Promise<Prefs | null> {
  if (!cache || cache.uid !== uid) {
    const promise = (async () => {
      const { data } = await browserClient()
        .from("reader_prefs")
        .select("areas, venues, name, institution")
        .eq("user_id", uid)
        .maybeSingle();
      return (data as Prefs | null) ?? null;
    })();
    cache = { uid, promise };
  }
  return cache.promise;
}

export async function savePrefs(uid: string, p: Prefs): Promise<string | null> {
  const { error } = await browserClient()
    .from("reader_prefs")
    .upsert({ user_id: uid, ...p, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (error) return error.message;
  cache = { uid, promise: Promise.resolve(p) };
  return null;
}
