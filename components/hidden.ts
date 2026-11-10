"use client";
// Papers a signed-in reader marked "Not relevant to me" (table paper_hides, migration 028),
// shared by every For you card on the page so a hidden one disappears everywhere at once.
// A skip in the hero deck is stored too, as a very weak signal (lib/forYou.ts).
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase";
const FOR_YOU_CACHE = "gp_foryou:"; // components/ForYou.tsx (not imported: it imports this file)

const hidden = new Set<string>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());

// The cached For you lists would show the paper again on the next visit.
function dropCachedLists() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith(FOR_YOU_CACHE)) localStorage.removeItem(k);
  } catch {}
}

export async function hidePaper(uid: string, id: string): Promise<boolean> {
  hidden.add(id);
  changed();
  const { error } = await browserClient().from("paper_hides").upsert({ user_id: uid, paper_id: id, kind: "hide" });
  if (error) {
    hidden.delete(id);
    changed();
    return false;
  }
  dropCachedLists();
  return true;
}

export async function unhidePaper(uid: string, id: string): Promise<void> {
  hidden.delete(id);
  changed();
  await browserClient().from("paper_hides").delete().eq("user_id", uid).eq("paper_id", id).eq("kind", "hide");
  dropCachedLists();
}

// A skip never overwrites a hide, and failures don't matter: it's a hint.
export function skipPaper(uid: string, id: string): void {
  void browserClient()
    .from("paper_hides")
    .upsert({ user_id: uid, paper_id: id, kind: "skip" }, { onConflict: "user_id,paper_id", ignoreDuplicates: true })
    .then(() => {}, () => {});
}

export function useHidden(id: string): boolean {
  const [on, setOn] = useState(hidden.has(id));
  useEffect(() => {
    const f = () => setOn(hidden.has(id));
    listeners.add(f);
    f();
    return () => void listeners.delete(f);
  }, [id]);
  return on;
}
