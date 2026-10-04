import { getPaper } from "./openalex";
import { adminClient, serverClient } from "./supabase";
import { writeTakes } from "./takes";
import type { Judgement } from "./judge";
import { spokespersons, type PersonaId } from "./personas";
import type { AiVerdict, Paper, Score } from "./types";

export const PAPER_ID = /^(W\d+|rp-[a-z0-9-]+)$/;

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
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Our database first (it may hold manual papers), then OpenAlex.
export async function getPaperAnywhere(id: string): Promise<Paper | null> {
  if (!PAPER_ID.test(id)) return null;
  const { data } = await serverClient().from("papers").select("*").eq("id", id).maybeSingle();
  if (data && data.abstract) return rowToPaper(data);
  const fromOpenAlex = id.startsWith("W") ? await getPaper(id) : null;
  return fromOpenAlex ?? (data ? rowToPaper(data) : null);
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

export function isAuthorized(req: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}
