"use client";
import { TOPICS_COOKIE } from "@/lib/forYou";

// Tells the server which topics to move up in "All papers" (lib/forYou.ts, mergeByTopics).
// Returns true when they changed, so the list can be re-rendered.
export function rememberTopics(topics: string[]): boolean {
  const value = [...topics].sort().join(",");
  const now = document.cookie.split("; ").find((c) => c.startsWith(`${TOPICS_COOKIE}=`))?.slice(TOPICS_COOKIE.length + 1) ?? "";
  if (value === now) return false;
  document.cookie = value
    ? `${TOPICS_COOKIE}=${value}; path=/; max-age=${60 * 86400}; samesite=lax`
    : `${TOPICS_COOKIE}=; path=/; max-age=0`;
  return true;
}
