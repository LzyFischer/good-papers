import { EARLY_READERS, TIERS, type Score } from "@/lib/types";

type Counts = Pick<Score, "score" | "reader_total" | "ai_total">;

export function tierOf(s: Counts | null | undefined) {
  if (!s || s.score === null || s.score === undefined) return null;
  const tier = TIERS.find((t) => s.score! >= t.min) ?? TIERS[TIERS.length - 1];
  return { pct: Math.round(s.score * 100), label: tier.label, tone: tier.tone, early: s.reader_total < EARLY_READERS };
}

// What the headline rests on, in words.
export function basisOf(s: Counts) {
  const readers = s.reader_total === 0 ? "No readers yet" : `${s.reader_total} reader${s.reader_total === 1 ? "" : "s"}`;
  return s.ai_total > 0 ? `${readers}, AI panel included` : readers;
}

// Ring gauge filled to the score, colored by tier.
export function Gauge({ pct, tone, size = "lg" }: { pct: number; tone: number; size?: "lg" | "sm" }) {
  return (
    <span className={`gauge gauge--${size} tone-${tone}`} style={{ ["--p" as string]: pct }}>
      <b>{pct}%</b>
    </span>
  );
}

export function ScoreChip({ score }: { score: Counts | null | undefined }) {
  const t = tierOf(score);
  if (!t) return <span className="chip chip--pending">Unrated</span>;
  return (
    <span className={`chip tone-${t.tone}`} title={`${t.label}. ${basisOf(score!)}`}>
      <span className="chip-dot" />
      {t.pct}%
    </span>
  );
}
