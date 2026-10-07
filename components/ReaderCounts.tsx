"use client";
// Reader tallies on cards that update the moment you vote, without reloading the page
// (shelves are cached, and reloading a list would reshuffle it under you).
import { useEffect, useState } from "react";

export type VoteEvent = { id: string; prev: boolean | null | undefined; next: boolean | null | undefined };

export function ReaderCounts({ id, fresh, total, kind }: { id: string; fresh: number; total: number; kind: "mini" | "pct" | "text" }) {
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
    window.addEventListener("gp-voted", on);
    return () => window.removeEventListener("gp-voted", on);
  }, [id]);
  const pct = c.total ? Math.round((c.fresh / c.total) * 100) : 0;
  if (kind === "pct") return <>{c.total ? `${pct}%` : "–"}</>;
  if (kind === "text") return <>{c.total ? `${c.fresh} of ${c.total} upvoted` : "No votes yet"}</>;
  return <>{c.total ? ` · ${pct}% of ${c.total} reader${c.total === 1 ? "" : "s"} upvoted` : ""}</>;
}
