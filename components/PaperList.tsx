import Link from "next/link";
import { dedupeByTitle } from "@/lib/openalex";
import { getScores } from "@/lib/papers";
import type { Paper } from "@/lib/types";
import { openScoreIds } from "@/lib/trending";
import { PaperRow } from "./PaperRow";

// A full list from OpenAlex with our scores where we have them; unrated papers
// get judged when someone opens them. Paged by ?page=.
export async function PaperList({ papers: raw, total, page, pageSize = 50, baseHref }: {
  papers: Paper[]; total: number; page: number; pageSize?: number; baseHref: string;
}) {
  const openIds = await openScoreIds().catch(() => [] as string[]);
  const papers = dedupeByTitle(raw, (p) => p.title);
  const scores = await getScores(papers.map((p) => p.id));
  const sep = baseHref.includes("?") ? "&" : "?";
  const pages = Math.ceil(total / pageSize);
  return (
    <>
      {papers.length === 0 ? (
        <p className="empty">No papers found.</p>
      ) : (
        <ul className="paper-list">
          {papers.map((p) => (
            <PaperRow key={p.id} {...p} score={scores.get(p.id) ?? null} scoreOpen={openIds.includes(p.id)} />
          ))}
        </ul>
      )}
      {pages > 1 && (
        <nav className="pager" aria-label="Pages">
          {page > 1 && <Link href={`${baseHref}${sep}page=${page - 1}`}>← Newer</Link>}
          <span>
            Page {page} of {pages}
          </span>
          {page < pages && <Link href={`${baseHref}${sep}page=${page + 1}`}>Older →</Link>}
        </nav>
      )}
    </>
  );
}
