import type { Metadata } from "next";
import { PaperRow } from "@/components/PaperRow";
import { arxivIdOf } from "@/lib/arxiv";
import { dedupeByTitle, getPapersByArxivIds, normTitle, searchPapers } from "@/lib/openalex";
import { getScores, withStoredIds } from "@/lib/papers";
import { searchS2 } from "@/lib/s2";
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
    // OpenAlex and Semantic Scholar side by side: S2 has last week's arXiv papers,
    // OpenAlex has institutions and everything else. Either one alone is enough.
    const [oa, s2] = await Promise.allSettled([searchPapers(query), searchS2(query)]);
    const fromOA = oa.status === "fulfilled" ? oa.value : [];
    let fromS2 = s2.status === "fulfilled" ? s2.value : [];
    failed = oa.status === "rejected" && (s2.status === "rejected" || fromS2.length === 0);
    // S2 hits OpenAlex does know get OpenAlex's version (it has institutions).
    const titles = new Set(fromOA.map((p) => normTitle(p.title)));
    fromS2 = fromS2.filter((p) => !titles.has(normTitle(p.title)));
    const inOA = new Set(fromOA.map((p) => arxivIdOf(p.url)).filter(Boolean));
    const missing = fromS2.map((p) => arxivIdOf(p.url)!).filter((a) => !inOA.has(a));
    const oaVersions = new Map(
      (await getPapersByArxivIds(missing).catch(() => [])).map((p) => [arxivIdOf(p.url) ?? "", p]),
    );
    fromS2 = fromS2.map((p) => {
      const v = oaVersions.get(arxivIdOf(p.url)!);
      return v ? { ...v, abstract: v.abstract ?? p.abstract } : p;
    });
    const merged: Paper[] = [];
    for (let i = 0; i < Math.max(fromOA.length, fromS2.length); i++) merged.push(...[fromS2[i], fromOA[i]].filter(Boolean));
    results = await withStoredIds(merged);
  }
  const scores = await getScores(results.map((r) => r.id));
  // Rated papers first, most votes first (readers, then the AI panel); the rest keep search relevance order.
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
