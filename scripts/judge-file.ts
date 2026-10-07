// Judge papers listed in a JSON file and store them, e.g. your own papers:
//   npm run judge -- scripts/my-papers.json
// Needs TYPESAFE_API_KEY and SUPABASE_SERVICE_ROLE_KEY in .env.local
// (ANTHROPIC_API_KEY optional, for the one-line takes).
import { readFileSync } from "node:fs";
import { judgePaper } from "../lib/judge";
import { getCitationCounts } from "../lib/openalex";
import { manualId, refreshAiCurve, storeJudgement } from "../lib/papers";
import type { Paper } from "../lib/types";

type Entry = {
  id?: string;
  title: string;
  authors?: string[];
  year?: number;
  venue?: string;
  url?: string;
  abstract?: string;
  orgs?: string[];
  tags?: string[];
  publishedOn?: string;
  reviewers?: { fresh: number; total: number; note?: string };
};

async function main() {
  const file = process.argv[2] ?? "scripts/my-papers.json";
  const entries = JSON.parse(readFileSync(file, "utf8")) as Entry[];
  const citations = await getCitationCounts(entries.map((e) => e.id ?? ""));

  for (const e of entries) {
    const paper: Paper = {
      id: e.id ?? manualId(e.title),
      title: e.title,
      authors: e.authors ?? [],
      year: e.year ?? null,
      venue: e.venue ?? null,
      url: e.url ?? null,
      abstract: e.abstract?.trim() || null,
      orgs: e.orgs ?? [],
      tags: e.tags ?? [],
      publishedOn: e.publishedOn ?? null,
      citedByCount: e.id ? citations.get(e.id) ?? null : null,
    };
    if (!paper.abstract) {
      console.warn(`Skipped "${paper.title}": add its abstract first.`);
      continue;
    }
    try {
      const j = await judgePaper(paper);
      await storeJudgement(paper, j, { reviewers: e.reviewers });
      const fresh = j.verdicts.filter((v) => v.fresh).length;
      console.log(`${paper.id}  ${fresh}/${j.verdicts.length} fresh  area=${j.area}  (${j.model})`);
      for (const v of j.verdicts) {
        console.log(`   ${v.fresh ? "FRESH " : "ROTTEN"} ${v.probability.toFixed(2)}  ${v.persona}  ${v.take ?? ""}`);
      }
    } catch (err) {
      console.error(`Failed on "${paper.title}":`, err);
    }
  }
  await refreshAiCurve();
}

main();
