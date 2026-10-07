// Hugging Face Papers: the daily/weekly/monthly lists (what the community is upvoting)
// rank our Trending shelf and feed the daily cron, so popular papers get rated even if
// OpenAlex's feed misses them.
import { arxivIdOf, getArxivPapers } from "./arxiv";
import { getPapersByArxivIds } from "./openalex";
import type { Paper } from "./types";

export type HfWindow = "day" | "week" | "month" | "year";
type HfItem = { arxivId: string; upvotes: number };

// ISO week, as Hugging Face's weekly list names it ("2026-W41").
function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  t.setUTCDate(t.getUTCDate() + 3 - ((t.getUTCDay() + 6) % 7)); // Thursday of this week
  const jan4 = new Date(Date.UTC(t.getUTCFullYear(), 0, 4));
  const week = 1 + Math.round(((t.getTime() - jan4.getTime()) / 86400_000 - 3 + ((jan4.getUTCDay() + 6) % 7)) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

async function hfList(query: string, revalidate = 1800): Promise<HfItem[]> {
  const res = await fetch(`https://huggingface.co/api/daily_papers?${query}&limit=100`, {
    signal: AbortSignal.timeout(8000),
    next: { revalidate }, // the home page reads these on every view
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
  if (window === "year") return getHfPastYear(limit);
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

// arXiv ids start with the year and month of submission: 2510.22200 is October 2025.
const monthsAgo = (arxivId: string, now: Date) =>
  (now.getUTCFullYear() % 100 - Number(arxivId.slice(0, 2))) * 12 + now.getUTCMonth() + 1 - Number(arxivId.slice(2, 4));

// The past year's standouts: the most upvoted papers of each of the last 12 monthly
// lists, plus papers from the last 12 months on HF's all-time trending page (older
// papers that are hot again, like vLLM, are left out). Upvote counts keep growing on
// HF, so raw counts would favor recent months: rank by place within the month instead
// (every month's #1, then every #2, ...), upvotes breaking ties.
export async function getHfPastYear(limit = 60, perMonth = 8): Promise<HfItem[]> {
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, i) =>
    new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7),
  );
  const lists = await Promise.all([
    ...months.map((m, i) =>
      hfList(`month=${m}`, i === 0 ? 1800 : 86400) // past months barely change
        .then((l) => l.sort((a, b) => b.upvotes - a.upvotes).slice(0, perMonth))
        .catch(() => []),
    ),
    hfList("sort=trending").then((l) => l.filter((x) => monthsAgo(x.arxivId, now) <= 12).slice(0, perMonth)).catch(() => []),
  ]);
  const best = new Map<string, HfItem & { place: number }>();
  for (const list of lists)
    list.forEach((x, place) => {
      const had = best.get(x.arxivId);
      if (!had || place < had.place) best.set(x.arxivId, { ...x, place });
    });
  return [...best.values()]
    .sort((a, b) => a.place - b.place || b.upvotes - a.upvotes)
    .slice(0, limit)
    .map(({ arxivId, upvotes }) => ({ arxivId, upvotes }));
}

// Every list the Trending shelf shows (today, this week, this month, the past year),
// for the daily cron, so the shelf is complete even when nobody visits the home page.
export async function getHfTrendingPapers(): Promise<Paper[]> {
  return getPapersForArxivIds(await hfShelfIds());
}

// arXiv ids on every list the Trending shelf can show, today's first: the whole daily
// and weekly lists (up to 100 each, like huggingface.co/papers), the month's and the
// past year's top 60.
export async function hfShelfIds(): Promise<string[]> {
  const lists = await Promise.all([getHfList("day", 100), getHfList("week", 100), getHfList("month", 60), getHfList("year", 60)]);
  return [...new Set(lists.flat().map((t) => t.arxivId))];
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
