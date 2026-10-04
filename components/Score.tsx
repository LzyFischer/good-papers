import { FRESH_THRESHOLD, type Score } from "@/lib/types";
import { Icon } from "./Icons";

type Counts = Pick<Score, "score" | "reader_total" | "ai_total">;

export function verdictOf(s: Counts | null | undefined) {
  if (!s || s.score === null || s.score === undefined) return null;
  return { pct: Math.round(s.score * 100), fresh: s.score >= FRESH_THRESHOLD };
}

// What the headline rests on, in words.
export function basisOf(s: Counts) {
  const readers = s.reader_total === 0 ? "No readers yet" : `${s.reader_total} reader${s.reader_total === 1 ? "" : "s"}`;
  return s.ai_total > 0 ? `${readers}, AI panel included` : readers;
}

export function ScoreChip({ score }: { score: Counts | null | undefined }) {
  const v = verdictOf(score);
  if (!v) return <span className="chip chip--pending">Unrated</span>;
  return (
    <span className={`chip ${v.fresh ? "chip--fresh" : "chip--stale"}`} title={basisOf(score!)}>
      <Icon name={v.fresh ? "fresh" : "rotten"} />
      {v.pct}%
    </span>
  );
}
