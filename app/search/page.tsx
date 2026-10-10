import type { Metadata } from "next";
import { PaperRow } from "@/components/PaperRow";
import { findPapers } from "@/lib/search";
import { openScoreIds } from "@/lib/trending";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const openIds = await openScoreIds().catch(() => [] as string[]);
  const { q = "" } = await searchParams;
  const query = q.trim();

  const { results, scores, failed } = await findPapers(query);

  return (
    <main className="wrap page">
      <h1 className="page-title">{query ? `Papers matching “${query}”` : "Search papers"}</h1>
      {!query && <p className="empty">Type a title, author, or topic in the search box above.</p>}
      {failed && <p className="empty">Paper search isn&apos;t responding. Try again in a minute.</p>}
      {query && !failed && results.length === 0 && (
        <p className="empty">No papers match that. Try fewer words or the exact title.</p>
      )}
      {results.length > 0 && (
        <ul className="paper-list">
          {results.map((p) => (
            <PaperRow key={p.id} {...p} score={scores.get(p.id) ?? null} scoreOpen={openIds.includes(p.id)} />
          ))}
        </ul>
      )}
    </main>
  );
}
