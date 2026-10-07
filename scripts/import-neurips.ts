// Import NeurIPS 2026 accepted papers and give each an AI panel verdict.
//
// Inputs (both downloaded by the owner, not committed):
//   neurips-2026-orals-posters.json             neurips.cc conference data: titles, authors with
//                                               institutions, track, poster sessions, rooms
//   scripts/data/neurips-2026-openreview.json   abstracts from OpenReview (scripts/neurips_openreview.py)
//
// A paper we already have (same title) keeps its id and gets the conference fields; new
// ones are stored as "nips26-<OpenReview forum id>". AI discussions for new papers start
// when someone opens them (discuss_on_demand). Resumable: judged papers are skipped, and
// papers stored without an abstract are judged on a later run once one turns up.
//
// Usage: npm run import:neurips [max]
import { readFileSync } from "node:fs";
import { judgePaper, mapLimit } from "@/lib/judge";
import { normTitle } from "@/lib/openalex";
import { storeJudgement } from "@/lib/papers";
import { adminClient } from "@/lib/supabase";
import type { Paper } from "@/lib/types";

const VENUE = "NeurIPS 2026";
const CONCURRENCY = 6;

type Entry = {
  name: string;
  authors: { fullname: string; institution?: string | null }[] | null;
  decision: string | null;
  session: string | null;
  starttime: string | null;
  endtime: string | null;
  room_name: string | null;
  paper_url: string | null;
};
type OpenReview = Record<string, { title?: string; abstract?: string; keywords?: string[] }>;
type Session = { name: string; start: string | null; end: string | null; room: string | null };

const track = (d: string | null) => (/oral/i.test(d ?? "") ? "oral" : /spotlight/i.test(d ?? "") ? "spotlight" : "poster");
const RANK = { oral: 2, spotlight: 1, poster: 0 } as const;

async function storedTitles(): Promise<Map<string, string>> {
  const db = adminClient();
  const out = new Map<string, string>();
  for (let from = 0; ; from += 1000) {
    const { data } = await db.from("papers").select("id, title").order("id").range(from, from + 999);
    for (const r of data ?? []) out.set(normTitle(r.title), r.id);
    if (!data || data.length < 1000) return out;
  }
}

async function judgedIds(ids: string[]): Promise<Set<string>> {
  const db = adminClient();
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db.from("ai_verdicts").select("paper_id").in("paper_id", ids.slice(i, i + 300)).limit(10000);
    for (const r of data ?? []) out.add(r.paper_id);
  }
  return out;
}

(async () => {
  const max = Number(process.argv[2] ?? 100000);
  const entries = (JSON.parse(readFileSync("neurips-2026-orals-posters.json", "utf8")).results ?? []) as Entry[];
  const or = JSON.parse(readFileSync("scripts/data/neurips-2026-openreview.json", "utf8")) as OpenReview;

  // One paper per OpenReview forum; poster sessions merged across its entries.
  const papers = new Map<string, { forum: string; e: Entry; track: keyof typeof RANK; sessions: Session[] }>();
  for (const e of entries) {
    const forum = e.paper_url?.match(/id=([\w-]+)/)?.[1];
    if (!forum) continue;
    const p = papers.get(forum) ?? { forum, e, track: track(e.decision), sessions: [] };
    if (RANK[track(e.decision)] > RANK[p.track]) p.track = track(e.decision);
    if (e.session && !p.sessions.some((s) => s.name === e.session))
      p.sessions.push({ name: e.session, start: e.starttime, end: e.endtime, room: e.room_name });
    papers.set(forum, p);
  }
  console.log(`${papers.size} papers in the conference data`);

  const stored = await storedTitles();
  const rows = [...papers.values()].map(({ forum, e, track, sessions }) => {
    const info = or[forum] ?? {};
    const orgs = [...new Set((e.authors ?? []).map((a) => a.institution).filter((x): x is string => Boolean(x)))].slice(0, 8);
    // An earlier import's own row isn't "existing": it may have gained an abstract since.
    const match = stored.get(normTitle(e.name));
    const existing = match && !match.startsWith("nips26-") ? match : undefined;
    const paper: Paper = {
      id: existing ?? `nips26-${forum}`,
      title: info.title || e.name,
      authors: (e.authors ?? []).map((a) => a.fullname).filter(Boolean),
      year: 2026,
      venue: VENUE,
      url: `https://openreview.net/forum?id=${forum}`,
      abstract: info.abstract ?? null,
      orgs,
      tags: track === "oral" ? ["Oral"] : track === "spotlight" ? ["Spotlight"] : [],
      publishedOn: null,
      citedByCount: null,
    };
    const conf = { conf_track: track, conf_sessions: sessions, openreview_url: paper.url };
    return { paper, conf, existing: Boolean(existing) };
  });

  const db = adminClient();
  // Papers we already had: add the conference fields, keep everything else.
  const known = rows.filter((r) => r.existing);
  for (const r of known) await db.from("papers").update({ venue: VENUE, tags: r.paper.tags, ...r.conf }).eq("id", r.paper.id);
  console.log(`${known.length} were already here: conference fields added`);

  const fresh = rows.filter((r) => !r.existing);
  const judged = await judgedIds(fresh.map((r) => r.paper.id));
  const todo = fresh.filter((r) => !judged.has(r.paper.id)).slice(0, max);
  const noAbstract = todo.filter((r) => !r.paper.abstract);
  console.log(`${fresh.length} new, ${judged.size} already judged, ${todo.length} to go (${noAbstract.length} without an abstract)`);

  // Without an abstract the panel can't judge: store the paper so it's listed, unrated.
  for (let i = 0; i < noAbstract.length; i += 200) {
    const batch = noAbstract.slice(i, i + 200).map(({ paper, conf }) => ({
      id: paper.id, title: paper.title, authors: paper.authors.slice(0, 40), year: paper.year, venue: paper.venue,
      url: paper.url, orgs: paper.orgs, tags: paper.tags, discuss_on_demand: true, ...conf,
    }));
    const { error } = await db.from("papers").upsert(batch, { onConflict: "id" });
    if (error) throw error;
  }

  let done = 0;
  let failed = 0;
  const started = Date.now();
  await mapLimit(todo.filter((r) => r.paper.abstract), CONCURRENCY, async ({ paper, conf }) => {
    try {
      await storeJudgement(paper, await judgePaper(paper, { withTakes: false }));
      await db.from("papers").update({ ...conf, discuss_on_demand: true }).eq("id", paper.id);
      done++;
    } catch (e) {
      failed++;
      console.warn("failed", paper.id, String(e).slice(0, 120));
    }
    if ((done + failed) % 100 === 0) {
      const min = (Date.now() - started) / 60000;
      console.log(`${done} judged, ${failed} failed, ${min.toFixed(1)} min`);
    }
  });
  console.log(`done: ${done} judged, ${failed} failed`);
})();
