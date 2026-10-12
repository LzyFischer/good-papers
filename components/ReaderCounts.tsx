"use client";
// Reader tallies on cards that update the moment you vote, without reloading the page
// (shelves are cached, and reloading a list would reshuffle it under you).
import { useEffect, useState } from "react";

export type VoteEvent = { id: string; prev: boolean | null | undefined; next: boolean | null | undefined };

// "pct": the readers' share, for the Readers box (the line under it stays empty: "1 of 1
// upvoted" told readers little). Shelf cards don't show the split at all.
export function ReaderCounts({ id, fresh, total }: { id: string; fresh: number; total: number }) {
  const [c, setC] = useState({ fresh, total });
  useEffect(() => setC({ fresh, total }), [fresh, total]);
  useEffect(() => {
    const on = (e: Event) => {
      const v = (e as CustomEvent<VoteEvent>).detail;
      if (!v || v.id !== id) return;
      setC((x) => {
        let { fresh: f, total: t } = x;
        if (typeof v.prev === "boolean") (t -= 1), (f -= v.prev ? 1 : 0);
        if (typeof v.next === "boolean") (t += 1), (f += v.next ? 1 : 0);
        return { fresh: Math.max(0, f), total: Math.max(0, t) };
      });
    };
    // Then the exact numbers from the database (conflict-of-interest votes left out).
    const exact = (e: Event) => {
      const d = (e as CustomEvent<{ id: string; fresh: number; total: number }>).detail;
      if (d?.id === id) setC({ fresh: d.fresh, total: d.total });
    };
    window.addEventListener("gp-voted", on);
    window.addEventListener("gp-score", exact);
    return () => {
      window.removeEventListener("gp-voted", on);
      window.removeEventListener("gp-score", exact);
    };
  }, [id]);
  return <>{c.total ? `${Math.round((c.fresh / c.total) * 100)}%` : "–"}</>;
}
