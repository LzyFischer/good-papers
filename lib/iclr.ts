// ICLR standing page (/iclr): submissions of a year in review with their public scores, from
// Paper Copilot's crawl of OpenReview (scripts/iclr_sync.py, daily; migration 030).
import { serverClient } from "./supabase";

export const ICLR_YEAR = 2027;

export type IclrStats = {
  ref: { mean: [number, number][]; min: [number, number][]; max: [number, number][] };
  sdMean: number;
  spreadP75: number;
  scale: [number, number];
  hist: [number, number][];
  counts: { submitted: number; reviewed: number; live: number; withdrawn: number; deskRejected: number };
  lastBins?: [number, number, number][];
  confScale?: [number, number];
  model: { coef: number[]; intercept: number; shift?: number; targetShare?: number };
};

export type IclrPaper = {
  id: string;
  title: string;
  area: string | null;
  ratings: number[];
  confidences: number[];
  outcome: string;
  neighbors: string[];
  similar_last: { title: string; outcome: string; ratings: number[] }[];
  updated_at: string;
};

export type IclrNeighbor = { id: string; title: string; ratings: number[] };

export async function iclrStats(year = ICLR_YEAR): Promise<{ data: IclrStats; updated_at: string } | null> {
  const { data } = await serverClient().from("iclr_stats").select("data, updated_at").eq("year", year).maybeSingle();
  return (data as { data: IclrStats; updated_at: string } | null) ?? null;
}

export async function iclrPaper(id: string): Promise<IclrPaper | null> {
  const { data } = await serverClient()
    .from("iclr_submissions")
    .select("id, title, area, ratings, confidences, outcome, neighbors, similar_last, updated_at")
    .eq("id", id)
    .maybeSingle();
  return (data as IclrPaper | null) ?? null;
}

/** The paper's neighbours still in review with 3+ scores, closest first, at most 50. */
export async function iclrPool(ids: string[]): Promise<IclrNeighbor[]> {
  if (!ids.length) return [];
  const { data } = await serverClient().from("iclr_submissions").select("id, title, ratings, outcome").in("id", ids);
  const byId = new Map((data ?? []).map((r) => [r.id as string, r as IclrNeighbor & { outcome: string }]));
  return ids
    .map((i) => byId.get(i))
    .filter((r): r is IclrNeighbor & { outcome: string } => !!r && r.outcome === "pending" && r.ratings.length >= 3)
    .slice(0, 50)
    .map(({ id, title, ratings }) => ({ id, title, ratings }));
}

/** Titles containing every word of the query (the trigram index serves ilike), best matches first. */
export async function iclrSearch(q: string, year = ICLR_YEAR) {
  const words = [...new Set(q.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, " ").split(/\s+/).filter((w) => w.length >= 3))].slice(0, 6);
  if (!words.length) return [];
  let req = serverClient().from("iclr_submissions").select("id, title, ratings, outcome").eq("year", year);
  for (const w of words) req = req.ilike("title", `%${w}%`);
  const { data } = await req.limit(40);
  const want = q.trim().toLowerCase();
  return ((data ?? []) as { id: string; title: string; ratings: number[]; outcome: string }[])
    .sort((a, b) => Number(b.title.toLowerCase().includes(want)) - Number(a.title.toLowerCase().includes(want)) || a.title.length - b.title.length)
    .slice(0, 8);
}

/** An OpenReview link or bare forum id, if that's what was pasted. */
export function openreviewId(q: string): string | null {
  const link = q.match(/openreview\.net\/(?:forum|pdf)\?id=([A-Za-z0-9_-]{6,})/);
  if (link) return link[1];
  const t = q.trim(); // forum ids are 10 mixed-case characters, unlike a 10-letter word
  return /^[A-Za-z0-9_-]{10}$/.test(t) && /[A-Z0-9]/.test(t) && /[a-z]/.test(t) ? t : null;
}

export type IclrTopic = { key: string; n: number; left: number; mean: number | null; expected: number; batch?: number; area?: string | null; lastN?: number; lastRate?: number };
export type IclrTopics = { areas: IclrTopic[]; keywords: IclrTopic[] };

/** Competition by primary area and by author keyword (scripts/iclr_topics.py; migration 031). */
export async function iclrTopics(year = ICLR_YEAR): Promise<IclrTopics | null> {
  const { data, error } = await serverClient().from("iclr_stats").select("topics").eq("year", year).maybeSingle();
  if (error) return null;
  return ((data as { topics: IclrTopics | null } | null)?.topics) ?? null;
}
