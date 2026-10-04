// Re-judge every stored paper with the current AI panel, e.g. after editing
// lib/personas.ts or lib/areas.ts:
//   npm run rejudge
// Needs TYPESAFE_API_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local
// (ANTHROPIC_API_KEY optional, for the two takes).
import { judgePaper, mapLimit } from "../lib/judge";
import { getCitationCounts } from "../lib/openalex";
import { storeJudgement } from "../lib/papers";
import { adminClient } from "../lib/supabase";
import type { Paper } from "../lib/types";

async function main() {
  const { data, error } = await adminClient().from("papers").select("*").not("abstract", "is", null);
  if (error) throw error;
  const papers: Paper[] = (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    authors: r.authors ?? [],
    year: r.year,
    venue: r.venue,
    url: r.url,
    abstract: r.abstract,
    orgs: r.orgs ?? [],
    tags: r.tags ?? [],
    publishedOn: r.published_on,
    citedByCount: r.cited_by_count ?? null,
  }));
  const citations = await getCitationCounts(papers.map((p) => p.id));
  for (const p of papers) p.citedByCount = citations.get(p.id) ?? p.citedByCount;
  console.log(`Re-judging ${papers.length} papers`);

  let ok = 0;
  await mapLimit(papers, 3, async (paper) => {
    try {
      const j = await judgePaper(paper);
      await storeJudgement(paper, j);
      ok++;
      console.log(`${paper.id}  ${j.verdicts.filter((v) => v.fresh).length}/${j.verdicts.length}  ${j.area ?? "-"}`);
    } catch (err) {
      console.error(`Failed on "${paper.title}":`, err);
    }
  });
  console.log(`Done: ${ok}/${papers.length}`);
}

main();
