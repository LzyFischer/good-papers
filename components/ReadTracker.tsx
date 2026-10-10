"use client";
// Counts how long a signed-in reader actually reads a paper page (only while the tab is
// visible), for the "For you" shelf. Sent every 15 seconds and when the page is left.
import { useEffect } from "react";
import { browserClient } from "@/lib/supabase";
import { useSession } from "./AuthButton";

const TICK = 15;

export function ReadTracker({ paperId }: { paperId: string }) {
  const { session } = useSession();
  useEffect(() => {
    if (!session) return;
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
      browserClient().rpc("bump_view", { p_paper: paperId, p_seconds: Math.min(s, 60) }).then(() => {});
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
  }, [session, paperId]);
  return null;
}
