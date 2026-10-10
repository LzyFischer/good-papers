// Paper search shared by the search page and the agent API: OpenAlex, arXiv and (with a
// key) Semantic Scholar, merged and de-duplicated, rated papers first.
import { arxivIdOf, searchArxiv } from "./arxiv";
import { dedupeByTitle, getPapersByArxivIds, normTitle, searchPapers } from "./openalex";
import { getScores, withStoredIds } from "./papers";
import { searchS2 } from "./s2";
import type { Paper, Score } from "./types";

export async function findPapers(query: string): Promise<{ results: Paper[]; scores: Map<string, Score>; failed: boolean }> {
  let results: Paper[] = [];
  let failed = false;
  if (query.trim()) {
    // OpenAlex has institutions and everything published; arXiv (and Semantic Scholar,
    // when S2_API_KEY is set) has this week's papers, which OpenAlex indexes a week or two late.
    const [oa, ax, s2] = await Promise.allSettled([searchPapers(query.trim()), searchArxiv(query.trim()), searchS2(query.trim())]);
    const ok = (r: PromiseSettledResult<Paper[]>) => (r.status === "fulfilled" ? r.value : []);
    const fromOA = ok(oa);
    failed = fromOA.length === 0 && ok(ax).length === 0 && ok(s2).length === 0 && [oa, ax].some((r) => r.status === "rejected");
    // A hit OpenAlex also knows gets OpenAlex's version (it has institutions).
    const titles = new Set(fromOA.map((p) => normTitle(p.title)));
    const fresh = (l: Paper[]) => l.filter((p) => !titles.has(normTitle(p.title)));
    const [fromS2, fromArxiv] = [fresh(ok(s2)), fresh(ok(ax))];
    const missing = [...new Set([...fromS2, ...fromArxiv].map((p) => arxivIdOf(p.url)!))];
    const oaVersions = new Map(
      (await getPapersByArxivIds(missing).catch(() => [])).map((p) => [arxivIdOf(p.url) ?? "", p]),
    );
    const upgrade = (p: Paper) => {
      const v = oaVersions.get(arxivIdOf(p.url)!);
      return v ? { ...v, abstract: v.abstract ?? p.abstract } : p;
    };
    // Interleave the sources so each one's best hits come first.
    const lists = [fromS2.map(upgrade), fromArxiv.map(upgrade), fromOA];
    const merged: Paper[] = [];
    for (let i = 0; i < 20; i++) for (const l of lists) if (l[i]) merged.push(l[i]);
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
  // Rated versions sort first, so they're the ones kept.
  results = dedupeByTitle(dedupeByTitle(results, (p) => p.title), (p) => p.id).slice(0, 30);
  return { results, scores, failed };
}
