import { FRESH_THRESHOLD, type Score } from "@/lib/types";
import { Icon } from "./Icons";

type Counts = Pick<Score, "fresh" | "total">;

export function verdictOf(s: Counts | null | undefined) {
  if (!s || s.total === 0) return null;
  const share = s.fresh / s.total;
  return { pct: Math.round(share * 100), fresh: share >= FRESH_THRESHOLD };
}

export function ScoreChip({ score }: { score: Counts | null | undefined }) {
  const v = verdictOf(score);
  if (!v) return <span className="chip chip--pending">Unrated</span>;
  return (
    <span className={`chip ${v.fresh ? "chip--fresh" : "chip--stale"}`} title={`${score!.fresh} of ${score!.total} verdicts fresh`}>
      <Icon name={v.fresh ? "fresh" : "rotten"} />
      {v.pct}%
    </span>
  );
}
