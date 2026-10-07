// Good researchers: ranked by how good their papers on this site are, with their
// citation record as the prior, the same way the AI panel is the prior for a paper.
//
//   researcher score = (sum of w * paper score + PRIOR_PAPERS * prior) / (sum of w + PRIOR_PAPERS)
//   prior            = 0.45 + 0.47 * percentile of recent citations (OpenAlex's
//                      2-year mean citedness) among the researchers on the list
//   w                = 1 per paper, or FULL_CREDIT_AUTHORS / authors for big author lists
//
// Like CSRankings: rank within an area (citation norms differ a lot between fields),
// count a paper only in its area, and show "adjusted" paper counts (1 / authors per paper).
// Unlike CSRankings, paper quality comes from readers and the AI panel, not the venue.
import { AREAS } from "./areas";
import { serverClient } from "./supabase";

export const RESEARCHER = { PRIOR_PAPERS: 2, MIN_PAPERS: 2, FULL_CREDIT_AUTHORS: 10 };

export type Researcher = {
  id: string;
  name: string;
  institution: string | null;
  hIndex: number | null;
  recentCitations: number | null; // 2-year mean citedness
  citations: number | null;
  score: number;
  rated: number; // rated papers on this site (in the selected area)
  adjusted: number; // sum of 1 / authors
  papers: { id: string; title: string; score: number }[]; // best first
};

type Row = {
  author_id: string; n_authors: number; institution: string | null;
  paper_id: string; title: string; area: string; score: number; published_on: string | null;
};
type Stats = { id: string; name: string; institution: string | null; h_index: number | null; cited_by_count: number | null; two_yr_citedness: number | null };

export async function rankResearchers(group: string | null, n = 50): Promise<Researcher[]> {
  const db = serverClient();
  const { data } = await db.from("researcher_papers").select("author_id, n_authors, institution, paper_id, title, area, score, published_on").limit(50000);
  const rows = ((data ?? []) as Row[]).filter((r) => !group || AREAS[r.area]?.group === group);

  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.author_id, [...(by.get(r.author_id) ?? []), r]);
  const eligible = [...by.entries()].filter(([, ps]) => ps.length >= RESEARCHER.MIN_PAPERS);
  if (!eligible.length) return [];

  const stats = new Map<string, Stats>();
  const ids = eligible.map(([id]) => id);
  for (let i = 0; i < ids.length; i += 300) {
    const { data: s } = await db
      .from("researchers")
      .select("id, name, institution, h_index, cited_by_count, two_yr_citedness")
      .in("id", ids.slice(i, i + 300));
    for (const r of (s ?? []) as Stats[]) stats.set(r.id, r);
  }

  // Percentile of recent citations among the researchers on this list.
  const cites = eligible.map(([id]) => stats.get(id)?.two_yr_citedness).filter((x): x is number => x != null).sort((a, b) => a - b);
  const prior = (x: number | null | undefined) => {
    if (x == null || cites.length < 2) return 0.5;
    const below = cites.filter((c) => c < x).length;
    return 0.45 + 0.47 * (below / (cites.length - 1));
  };

  const out: Researcher[] = [];
  for (const [id, ps] of eligible) {
    const s = stats.get(id);
    if (!s?.name) continue; // stats not fetched yet
    let sw = 0;
    let sws = 0;
    for (const p of ps) {
      const w = Math.min(1, RESEARCHER.FULL_CREDIT_AUTHORS / Math.max(1, p.n_authors));
      sw += w;
      sws += w * p.score;
    }
    // Their affiliation on their latest paper here; OpenAlex's "last known" is often stale.
    const latest = [...ps].filter((p) => p.institution).sort((a, b) => (b.published_on ?? "").localeCompare(a.published_on ?? ""))[0];
    out.push({
      id,
      name: s.name,
      institution: latest?.institution ?? s.institution,
      hIndex: s.h_index,
      recentCitations: s.two_yr_citedness,
      citations: s.cited_by_count,
      score: (sws + RESEARCHER.PRIOR_PAPERS * prior(s.two_yr_citedness)) / (sw + RESEARCHER.PRIOR_PAPERS),
      rated: ps.length,
      adjusted: ps.reduce((a, p) => a + 1 / Math.max(1, p.n_authors), 0),
      papers: [...ps].sort((a, b) => b.score - a.score).slice(0, 3).map((p) => ({ id: p.paper_id, title: p.title, score: p.score })),
    });
  }
  return out.sort((a, b) => b.score - a.score || b.adjusted - a.adjusted).slice(0, n);
}

