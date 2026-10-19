"use client";
// "★ Top pick" on a paper in the top 5% of its area (lib/topPicks.ts). One request per page
// load for the cut-offs, shared by every badge on the page.
import { useEffect, useState } from "react";

let cutoffs: Promise<Record<string, number>> | null = null;
const none: Record<string, number> = {};
const load = (): Promise<Record<string, number>> =>
  (cutoffs ??= fetch("/api/top-picks")
    .then((r) => (r.ok ? (r.json() as Promise<Record<string, number>>) : none))
    .catch(() => none));

export function TopPick({ area, score, className }: { area: string | null; score: number | null; className?: string }) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!area || score === null) return;
    let live = true;
    load().then((c) => live && setOn(c[area] !== undefined && score >= c[area]));
    return () => {
      live = false;
    };
  }, [area, score]);
  if (!on) return null;
  return (
    <span className={className ? `top-pick ${className}` : "top-pick"} title="In the top 5% of its area">
      <span aria-hidden="true">★</span> Top pick
    </span>
  );
}
