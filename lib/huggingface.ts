// Hugging Face Papers: the trending list (what the community is upvoting) feeds
// the daily cron, so popular papers get rated even if OpenAlex's feed misses them.
import { arxivIdOf, getArxivPapers } from "./arxiv";
import { getPapersByArxivIds } from "./openalex";
import type { Paper } from "./types";

export async function getHfTrending(limit = 30): Promise<{ arxivId: string; upvotes: number }[]> {
  const res = await fetch(`https://huggingface.co/api/daily_papers?sort=trending&limit=${limit}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`Hugging Face trending failed (${res.status})`);
  const items = (await res.json()) as { paper?: { id?: string; upvotes?: number } }[];
  return items
    .map((x) => ({ arxivId: x.paper?.id ?? "", upvotes: x.paper?.upvotes ?? 0 }))
    .filter((x) => /^\d{4}\.\d{4,5}$/.test(x.arxivId));
}

export async function getHfTrendingPapers(limit = 30): Promise<Paper[]> {
  const ids = (await getHfTrending(limit)).map((t) => t.arxivId);
  const fromOA = await getPapersByArxivIds(ids);
  // Most trending papers are days old, before OpenAlex indexes them: take those from arXiv.
  const have = new Set(fromOA.map((p) => arxivIdOf(p.url)));
  const missing = ids.filter((a) => !have.has(a));
  const fromArxiv = missing.length ? await getArxivPapers(missing).catch(() => []) : [];
  return [...fromOA, ...fromArxiv];
}
