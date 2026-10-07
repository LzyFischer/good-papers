import { ARXIV_PAPER, arxivIdOf, arxivPaperId, getArxivPapers } from "./arxiv";
import { getCitationCounts, getPaper } from "./openalex";
import { adminClient, serverClient } from "./supabase";
import { writeTakes } from "./takes";
import type { Judgement } from "./judge";
import { spokespersons, type PersonaId } from "./personas";
import type { AiVerdict, Paper, Score } from "./types";

export const PAPER_ID = /^(W\d+|rp-[a-z0-9-]+|arxiv-\d{4}\.\d{4,5}|nips26-[\w-]+)$/;

export function manualId(title: string) {
  return (
    "rp-" +
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60)
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function rowToPaper(r: any): Paper {
  return {
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
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Our database first (it may hold manual papers), then OpenAlex or arXiv.
export async function getPaperAnywhere(id: string): Promise<Paper | null> {
  if (!PAPER_ID.test(id)) return null;
  const { data } = await serverClient().from("papers").select("*").eq("id", id).maybeSingle();
  if (data && data.abstract) return rowToPaper(data);
  const aid = id.match(ARXIV_PAPER)?.[1];
  const fetched = id.startsWith("W") ? await getPaper(id) : aid ? (await getArxivPapers([aid]))[0] ?? null : null;
  return fetched ?? (data ? rowToPaper(data) : null);
}

// One arXiv paper can reach us as an OpenAlex work ("W…") or as "arxiv-<id>".
// Whichever id we stored first is the paper's id for good: map arXiv ids to it.
export async function storedIdsByArxiv(aids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const unique = [...new Set(aids)].filter((a) => /^\d{4}\.\d{4,5}$/.test(a));
  for (let i = 0; i < unique.length; i += 40) {
    const batch = unique.slice(i, i + 40);
    // abs/, pdf/ or html/ links and arXiv DOIs; arxivIdOf below confirms the exact id.
    const or = batch.flatMap((a) => [`id.eq.${arxivPaperId(a)}`, `url.ilike.*${a}*`]).join(",");
    const { data } = await serverClient().from("papers").select("id, url").or(or);
    for (const r of (data ?? []) as { id: string; url: string | null }[]) {
      const a = r.id.match(ARXIV_PAPER)?.[1] ?? arxivIdOf(r.url);
      if (a && batch.includes(a) && !out.has(a)) out.set(a, r.id);
    }
  }
  return out;
}

// Give each paper the id it is already stored under, if any.
export async function withStoredIds<T extends Paper>(papers: T[]): Promise<T[]> {
  const stored = await storedIdsByArxiv(papers.map((p) => arxivIdOf(p.url) ?? "").filter(Boolean)).catch(() => new Map<string, string>());
  return papers.map((p) => {
    const id = stored.get(arxivIdOf(p.url) ?? "");
    return id && id !== p.id ? { ...p, id } : p;
  });
}

export async function getScores(ids: string[]): Promise<Map<string, Score>> {
  const map = new Map<string, Score>();
  if (ids.length === 0) return map;
  const { data } = await serverClient().from("paper_scores").select("*").in("id", ids);
  for (const s of (data ?? []) as Score[]) map.set(s.id, s);
  return map;
}

export async function getVerdicts(ids: string[]): Promise<Map<string, AiVerdict[]>> {
  const map = new Map<string, AiVerdict[]>();
  if (ids.length === 0) return map;
  const { data } = await serverClient()
    .from("ai_verdicts")
    .select("paper_id, persona, fresh, probability, take")
    .in("paper_id", ids);
  for (const v of (data ?? []) as AiVerdict[]) {
    const list = map.get(v.paper_id) ?? [];
    list.push(v);
    map.set(v.paper_id, list);
  }
  return map;
}

export async function storeJudgement(
  paper: Paper,
  j: Judgement,
  extra: { reviewers?: { fresh: number; total: number; note?: string } } = {},
) {
  const db = adminClient();
  const { error: pErr } = await db.from("papers").upsert({
    id: paper.id,
    title: paper.title,
    authors: paper.authors.slice(0, 40),
    year: paper.year,
    venue: paper.venue,
    url: paper.url,
    abstract: paper.abstract,
    orgs: paper.orgs,
    tags: paper.tags,
    area: j.area,
    paper_type: j.paperType,
    published_on: paper.publishedOn,
    cited_by_count: paper.citedByCount,
  });
  if (pErr) throw pErr;

  // Replace the whole panel, so a re-judge with a changed persona list leaves no stale rows.
  const { error: dErr } = await db.from("ai_verdicts").delete().eq("paper_id", paper.id);
  if (dErr) throw dErr;
  const { error: vErr } = await db.from("ai_verdicts").insert(
    j.verdicts.map((v) => ({
      paper_id: paper.id,
      persona: v.persona,
      fresh: v.fresh,
      probability: v.probability,
      take: v.take,
      model: j.model,
    })),
  );
  if (vErr) throw vErr;

  if (extra.reviewers) {
    const { error } = await db.from("reviewer_scores").upsert({
      paper_id: paper.id,
      source: "manual",
      fresh: extra.reviewers.fresh,
      total: extra.reviewers.total,
      note: extra.reviewers.note ?? null,
    });
    if (error) throw error;
  }
}

// Papers judged on page view get verdicts first; the cron writes the two takes
// (strongest supporter, strongest critic) afterwards for papers that have none.
export async function fillMissingTakes(limit = 5): Promise<number> {
  const db = adminClient();
  const { data } = await db
    .from("ai_verdicts")
    .select("paper_id, take")
    .order("created_at", { ascending: false })
    .limit(2000);
  const withTake = new Set<string>();
  const seen: string[] = [];
  for (const r of (data ?? []) as { paper_id: string; take: string | null }[]) {
    if (r.take) withTake.add(r.paper_id);
    if (!seen.includes(r.paper_id)) seen.push(r.paper_id);
  }
  const ids = seen.filter((id) => !withTake.has(id)).slice(0, limit);
  let done = 0;
  for (const id of ids) {
    const { data: row } = await db.from("papers").select("*").eq("id", id).maybeSingle();
    if (!row?.abstract) continue;
    const paper = rowToPaper(row);
    const { data: vs } = await db.from("ai_verdicts").select("persona, fresh, probability").eq("paper_id", id);
    const speakers = spokespersons((vs ?? []) as { persona: PersonaId; fresh: boolean; probability: number }[]);
    const takes = await writeTakes(paper, speakers).catch(() => null);
    if (!takes) continue;
    for (const v of speakers) {
      if (takes[v.persona]) {
        await db.from("ai_verdicts").update({ take: takes[v.persona] }).eq("paper_id", id).eq("persona", v.persona);
      }
    }
    done++;
  }
  return done;
}

// Citation counts change daily; refresh the stored ones from OpenAlex.
export async function refreshCitations(limit = 200): Promise<number> {
  const db = adminClient();
  const { data } = await db.from("papers").select("id").like("id", "W%").limit(limit);
  const counts = await getCitationCounts((data ?? []).map((r: { id: string }) => r.id));
  for (const [id, n] of counts) await db.from("papers").update({ cited_by_count: n }).eq("id", id);
  return counts.size;
}

// Site-wide cap on papers judged outside the daily cron (page views, the trending top-up),
// so a crawler or a busy hour can't run up the Jev bill.
const INLINE_JUDGE_PER_HOUR = 120; // counts every new paper, including the daily cron's batch
export async function underInlineBudget(papers = 1) {
  const { count } = await serverClient()
    .from("papers")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  return (count ?? 0) + papers <= INLINE_JUDGE_PER_HOUR;
}

export function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}
