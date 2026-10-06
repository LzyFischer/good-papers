import type { Metadata } from "next";
import { PaperRow } from "@/components/PaperRow";
import { dedupeByTitle, searchPapers } from "@/lib/openalex";
import { getScores } from "@/lib/papers";
import type { Paper } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const { q = "" } = await searchParams;
  const query = q.trim();

  let results: Paper[] = [];
  let failed = false;
  if (query) {
    try {
      results = await searchPapers(query);
    } catch {
      failed = true;
    }
  }
  const scores = await getScores(results.map((r) => r.id));
  // Rated papers first, most votes first (readers, then the AI panel); the rest keep OpenAlex's relevance order.
  const votes = (id: string) => {
    const s = scores.get(id);
    return s && s.score !== null ? [s.reader_total, s.ai_total] : null;
  };
  results = results
    .map((p, i) => ({ p, i, v: votes(p.id) }))
    .sort((a, b) => {
      if (a.v && !b.v) return -1;
      if (!a.v && b.v) return 1;
      if (a.v && b.v) return b.v[0] - a.v[0] || b.v[1] - a.v[1] || a.i - b.i;
      return a.i - b.i;
    })
    .map((x) => x.p);
  results = dedupeByTitle(results, (p) => p.title); // rated versions sort first, so they're the ones kept

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
            <PaperRow key={p.id} {...p} score={scores.get(p.id) ?? null} />
          ))}
        </ul>
      )}
    </main>
  );
}
