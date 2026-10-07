import Link from "next/link";
import type { Score } from "@/lib/types";
import { formatAuthors } from "./PaperCard";
import { Gate } from "./Gate";
import { ScoreChip } from "./Score";

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
      <Gate id={id} open={scoreOpen || score?.score == null} mask={<span className="chip chip--pending">?</span>}>
        <ScoreChip score={score} />
      </Gate>
      <div>
        <Link href={`/paper/${id}`} className="paper-title">
          {title}
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
