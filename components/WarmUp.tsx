"use client";
// Asks /api/warm to judge a new paper (or queue its AI discussion) once a reader has had the
// page visible for a few seconds, then reloads it with the score. Crawlers that only fetch
// the HTML never get this far, so they no longer spend the AI panel's budget.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const VISIBLE_MS = 3000;

export function WarmUp({ id, unjudged }: { id: string; unjudged: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let seen = 0;
    let last = document.visibilityState === "visible" ? Date.now() : 0;
    let done = false;
    const tick = setInterval(() => {
      if (done) return;
      const now = Date.now();
      if (last) seen += now - last;
      last = document.visibilityState === "visible" ? now : 0;
      if (seen < VISIBLE_MS) return;
      done = true;
      clearInterval(tick);
      if (unjudged) setBusy(true);
      fetch("/api/warm", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) })
        .then((r) => r.json())
        .then((r: { judged?: boolean }) => r.judged && router.refresh())
        .catch(() => {})
        .finally(() => setBusy(false));
    }, 500);
    return () => clearInterval(tick);
  }, [id, unjudged, router]);
  return busy ? <p className="warmup">The AI panel is reading this paper…</p> : null;
}
