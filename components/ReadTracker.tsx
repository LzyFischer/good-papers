"use client";
// Counts how long a reader actually reads a paper page (only while the tab is visible), for
// the "For you" shelf: signed in, sent to reader_views every 15 seconds and when the page is
// left; not signed in, kept in this browser only (guestHistory.ts).
import { useEffect } from "react";
import { browserClient } from "@/lib/supabase";
import { useSession } from "./AuthButton";
import { addToHistory } from "./guestHistory";

const TICK = 15;

export function ReadTracker({ paperId }: { paperId: string }) {
  const { session, ready } = useSession();
  useEffect(() => {
    if (!ready) return;
    if (!session) addToHistory(paperId, 0); // opening a paper counts a little
    let pending = 0;
    let since = document.visibilityState === "visible" ? Date.now() : 0;
    const take = () => {
      if (since) pending += (Date.now() - since) / 1000;
      since = document.visibilityState === "visible" ? Date.now() : 0;
    };
    const flush = () => {
      take();
      const s = Math.round(pending);
      if (s < 3) return; // a glance isn't reading
      pending = 0;
      if (session) browserClient().rpc("bump_view", { p_paper: paperId, p_seconds: Math.min(s, 60) }).then(() => {});
      else addToHistory(paperId, s);
    };
    const tick = setInterval(flush, TICK * 1000);
    const vis = () => (document.visibilityState === "hidden" ? flush() : take());
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("pagehide", flush);
    return () => {
      flush();
      clearInterval(tick);
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("pagehide", flush);
    };
  }, [ready, session, paperId]);
  return null;
}
