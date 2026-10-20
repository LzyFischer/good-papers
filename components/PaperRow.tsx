import Link from "next/link";
import type { Score } from "@/lib/types";
import { formatAuthors } from "./PaperCard";
import { Gate } from "./Gate";
import { ScoreChip, tierOf } from "./Score";
import { tex } from "@/lib/latex";

type Props = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  score: Score | null;
  scoreOpen?: boolean;
};

export function PaperRow({ id, title, authors, year, venue, score, scoreOpen = false }: Props) {
  return (
    <li className="paper-row">
      <Gate id={id} open={scoreOpen || score?.score == null} mask={
        <span className="chip chip--pending" title="Vote to see the score" aria-label={`${tierOf(score)?.label ?? "Rated"}, vote to see the score`}>
          {tierOf(score)?.label ?? "?"}
          <svg className="chip-lock" viewBox="0 0 16 16" width="11" height="11" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>
        </span>
      }>
        <ScoreChip score={score} />
      </Gate>
      <div>
        <Link href={`/paper/${id}`} className="paper-title">
          {tex(title)}
        </Link>
        <p className="paper-meta">
          {formatAuthors(authors, 3)}
          {(year || venue) && <br />}
          {[venue, year].filter(Boolean).join(", ")}
        </p>
      </div>
    </li>
  );
}
