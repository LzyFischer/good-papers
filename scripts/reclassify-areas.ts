// Re-pick the fine area of stored papers inside their current group, e.g. after adding
// areas to lib/areas.ts. One Jev call per paper, far cheaper than `npm run rejudge`.
//   npm run reclassify -- agents,llm,rl,safety,generative 2026-01-01 [--dry] [--into=a,b,c]
// Groups default to all; the date limits it to papers published since then. --into keeps
// only moves into those areas (the new ones): a fresh pick between old areas is mostly noise.
import { AREAS } from "../lib/areas";
import { mapLimit, pickFineArea } from "../lib/judge";
import { adminClient } from "../lib/supabase";

async function main() {
  const [groupsArg, since] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const dry = process.argv.includes("--dry");
  const into = new Set((process.argv.find((a) => a.startsWith("--into="))?.slice(7) ?? "").split(",").filter(Boolean));
  const groups = new Set((groupsArg ?? "").split(",").filter(Boolean));
  const keys = Object.entries(AREAS).filter(([, a]) => !groups.size || groups.has(a.group)).map(([k]) => k);
  const db = adminClient();
  const rows: { id: string; title: string; abstract: string; venue: string | null; area: string }[] = [];
  for (let from = 0; ; from += 1000) {
    let q = db.from("papers").select("id, title, abstract, venue, area").in("area", keys).not("abstract", "is", null);
    if (since) q = q.gte("published_on", since);
    const { data, error } = await q.order("id").range(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  console.log(`${rows.length} papers in ${groups.size ? [...groups].join(", ") : "all groups"}${since ? ` since ${since}` : ""}${dry ? " (dry run)" : ""}`);
  let changed = 0, done = 0;
  await mapLimit(rows, 4, async (r) => {
    try {
      const area = await pickFineArea({ id: r.id, title: r.title, abstract: r.abstract, venue: r.venue, authors: [], year: null, url: null, orgs: [], tags: [], publishedOn: null, citedByCount: null }, AREAS[r.area].group);
      if (area && area !== r.area && (!into.size || into.has(area))) {
        changed++;
        console.log(`${r.id}: ${r.area} -> ${area} · ${r.title.slice(0, 70)}`);
        if (!dry) await db.from("papers").update({ area }).eq("id", r.id);
      }
    } catch (e) {
      console.warn("failed", r.id, e);
    }
    if (++done % 100 === 0) console.log(`${done}/${rows.length}`);
  });
  console.log(`${changed} papers moved to a different area`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
