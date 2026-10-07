// Hugging Face Papers: the daily/weekly/monthly lists (what the community is upvoting)
// rank our Trending shelf and feed the daily cron, so popular papers get rated even if
// OpenAlex's feed misses them.
import { arxivIdOf, getArxivPapers } from "./arxiv";
import { getPapersByArxivIds } from "./openalex";
import type { Paper } from "./types";

export type HfWindow = "day" | "week" | "month";
type HfItem = { arxivId: string; upvotes: number };

// ISO week, as Hugging Face's weekly list names it ("2026-W41").
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // Thursday of this week
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - jan4.getTime()) / 86400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function hfList(query: string): Promise<HfItem[]> {
  const res = await fetch(`https://huggingface.co/api/daily_papers?${query}&limit=100`, {
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 1800 }, // the home page reads these on every view
  });
  if (!res.ok) throw new Error(`Hugging Face papers failed (${res.status})`);
  const items = (await res.json()) as { paper?: { id?: string; upvotes?: number } }[];
  return items
    .map((x) => ({ arxivId: x.paper?.id ?? "", upvotes: x.paper?.upvotes ?? 0 }))
    .filter((x) => /^\d{4}\.\d{4,5}$/.test(x.arxivId));
}

// Hugging Face's daily, weekly and monthly lists: papers submitted that day, week or
// month, most upvoted first, the same lists as huggingface.co/papers/{date,week,month}.
// Early in a period the list is thin, so the previous period is added after it.
export async function getHfList(window: HfWindow, limit = 30): Promise<HfItem[]> {
  const now = new Date();
  const back = new Date(now.getTime() - (window === "day" ? 1 : window === "week" ? 7 : 31) * 86400_000);
  const key = (d: Date) =>
    window === "day" ? `date=${d.toISOString().slice(0, 10)}` : window === "week" ? `week=${isoWeek(d)}` : `month=${d.toISOString().slice(0, 7)}`;
  const current = await hfList(key(now)).catch(() => []);
  const enough = window === "day" ? 10 : 20;
  const previous = current.length < enough ? await hfList(key(back)).catch(() => []) : [];
  const seen = new Set<string>();
  return [...current.sort((a, b) => b.upvotes - a.upvotes), ...previous.sort((a, b) => b.upvotes - a.upvotes)]
    .filter((x) => !seen.has(x.arxivId) && Boolean(seen.add(x.arxivId)))
    .slice(0, limit);
}

// This week's list, for the daily cron.
export async function getHfTrendingPapers(limit = 30): Promise<Paper[]> {
  return getPapersForArxivIds((await getHfList("week", limit)).map((t) => t.arxivId));
}

// OpenAlex's version where it has one (institutions), arXiv's otherwise.
export async function getPapersForArxivIds(ids: string[]): Promise<Paper[]> {
  if (!ids.length) return [];
  const fromOA = await getPapersByArxivIds(ids);
  // Most trending papers are days old, before OpenAlex indexes them: take those from arXiv.
  const have = new Set(fromOA.map((p) => arxivIdOf(p.url)));
  const missing = ids.filter((a) => !have.has(a));
  const fromArxiv = missing.length ? await getArxivPapers(missing).catch(() => []) : [];
  return [...fromOA, ...fromArxiv];
}
