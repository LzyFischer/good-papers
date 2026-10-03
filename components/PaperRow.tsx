import Link from "next/link";
import type { Score } from "@/lib/types";
import { formatAuthors } from "./PaperCard";
import { ScoreChip } from "./Score";

type Props = {
  id: string;
  title: string;
  authors: string[];
  year: number | null;
  venue: string | null;
  score: Score | null;
};

export function PaperRow({ id, title, authors, year, venue, score }: Props) {
  return (
    <li className="paper-row">
      <ScoreChip score={score} />
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
