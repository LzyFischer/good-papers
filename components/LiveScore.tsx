"use client";
// A card's score that follows your vote: after you vote, VoteButtons reads the paper's new
// score from the database and announces it ("gp-score"); every gauge and label for that
// paper on the page updates without reloading.
import { useEffect, useState } from "react";
import { TIERS } from "@/lib/types";
import { Gauge } from "./Score";

export type ScoreEvent = { id: string; score: number | null; fresh: number; total: number };

function tier(score: number) {
  return TIERS.find((t) => score >= t.min) ?? TIERS[TIERS.length - 1];
}

export function useLiveScore(id: string, initial: number | null) {
  const [score, setScore] = useState(initial);
  useEffect(() => setScore(initial), [initial]);
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<ScoreEvent>).detail;
      if (d?.id === id && d.score !== null) setScore(d.score);
    };
    window.addEventListener("gp-score", on);
    return () => window.removeEventListener("gp-score", on);
  }, [id]);
  return score;
}

export function LiveGauge({ id, score, size = "lg" }: { id: string; score: number; size?: "lg" | "sm" }) {
  const s = useLiveScore(id, score) ?? score;
  return <Gauge pct={Math.round(s * 100)} tone={tier(s).tone} size={size} />;
}

export function LiveLabel({ id, score }: { id: string; score: number }) {
  const s = useLiveScore(id, score) ?? score;
  return <>{tier(s).label}</>;
}
