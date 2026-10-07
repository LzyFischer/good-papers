// Home page shelves. Trending ranks recent activity on our site plus Hugging Face
// upvotes; quality (the score) is a separate shelf, so popularity never stands in
// for "worth reading".
import { unstable_cache } from "next/cache";
import { getHfList } from "./huggingface";
import { neuripsTrending } from "./neurips";
import { storedIdsByArxiv } from "./papers";
import { serverClient } from "./supabase";
import type { Score } from "./types";

export const WINDOWS = { day: 1, week: 7, month: 30, year: 365 } as const;
export type Window = keyof typeof WINDOWS;
export const WINDOW_LABELS: Record<Window, string> = { day: "Today", week: "This week", month: "This month", year: "Past year" };

const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

// trending = 3 x reader votes + 2 x reader comments + likes (all within the window)
//          + HF upvotes / 10 for papers published within the window
//          + a bonus for the paper's place on Hugging Face's list for the same window
//            (daily / weekly / monthly, or the past year's standouts; #1 gets the most)
export async function trending(window: Window, n = 12): Promise<Score[]> {
  const db = serverClient();
  const from = since(WINDOWS[window]);
  const hfNow = getHfList(window, window === "year" ? 60 : 30).catch(() => []);
  const [votes, comments, likes, fresh] = await Promise.all([
    db.from("ratings").select("paper_id").gte("updated_at", from).not("worth_reading", "is", null).limit(5000),
    db.from("comments").select("paper_id").eq("author_kind", "user").gte("created_at", from).limit(5000),
    db.from("comment_likes").select("comments(paper_id)").gte("created_at", from).limit(5000),
    db.from("paper_scores").select("id, hf_upvotes").gte("published_on", from.slice(0, 10)).gt("hf_upvotes", 0).limit(500),
  ]);
  const heat = new Map<string, number>();
  const add = (id: string | undefined, x: number) => id && heat.set(id, (heat.get(id) ?? 0) + x);
  for (const r of votes.data ?? []) add(r.paper_id, 3);
  for (const r of comments.data ?? []) add(r.paper_id, 2);
  for (const r of (likes.data ?? []) as unknown as { comments: { paper_id: string } | null }[]) add(r.comments?.paper_id, 1);
  for (const r of fresh.data ?? []) add(r.id, (r.hf_upvotes ?? 0) / 10);
  const hf = await hfNow;
  const stored = await storedIdsByArxiv(hf.map((t) => t.arxivId)).catch(() => new Map<string, string>());
  hf.forEach((t, rank) => add(stored.get(t.arxivId), hf.length - rank));
  const ids = [...heat.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
  if (ids.length === 0) return [];
  const { data } = await db.from("paper_scores").select("*").in("id", ids).not("score", "is", null).not("area", "is", null);
  const byId = new Map(((data ?? []) as Score[]).map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter((s): s is Score => Boolean(s));
}

export async function shelf(kind: "must" | "debated", n = 12): Promise<Score[]> {
  // Papers opened from author or institution pages can be outside ML; shelves show ML areas only.
  let q = serverClient().from("paper_scores").select("*").not("score", "is", null).not("area", "is", null);
  // Must read: this year's papers only (the last 12 months early in the year, when that's thin).
  if (kind === "must") {
    const now = new Date();
    const jan1 = `${now.getUTCFullYear()}-01-01`;
    const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
    const since = now.getUTCMonth() >= 2 ? jan1 : yearAgo;
    q = q.gte("score", 0.8).gte("published_on", since).order("score", { ascending: false });
  }
  if (kind === "debated") q = q.gt("comments", 0).order("comments", { ascending: false });
  const { data } = await q.limit(n);
  return (data ?? []) as Score[];
}

// Paper of the day: the highest-scored paper trending this week, one with a picture if possible.
export function pickPaperOfTheDay(week: Score[]): Score | undefined {
  const best = (l: Score[]) => [...l].sort((a, b) => (b.score ?? 0) - (a.score ?? 0))[0];
  return best(week.filter((s) => s.thumbnail)) ?? best(week);
}

// Scores are hidden until you vote, except on the first half of each home page shelf
// (Trending this week, Trending at NeurIPS, Must read, Most debated) and the paper of the
// day, which show theirs to everyone as a preview. Cached for ten minutes.
export const SHELF_SIZE = 24;
export const openScoreIds = unstable_cache(
  async () => {
    const [week, nips, must, debated] = await Promise.all([
      trending("week", SHELF_SIZE), neuripsTrending(SHELF_SIZE), shelf("must", SHELF_SIZE), shelf("debated", SHELF_SIZE),
    ]);
    const half = (l: Score[]) => l.slice(0, Math.ceil(l.length / 2)).map((s) => s.id);
    const spot = pickPaperOfTheDay(week);
    return [...new Set([...half(week), ...half(nips), ...half(must), ...half(debated), ...(spot ? [spot.id] : [])])];
  },
  ["open-score-ids-v3"],
  { revalidate: 600 },
);

// The home page's four shelves, shared by every visitor for two minutes: they change slowly,
// and computing them takes several database round trips.
export const homeShelves = unstable_cache(
  async (window: Window) =>
    Promise.all([trending(window, SHELF_SIZE), shelf("must", SHELF_SIZE), shelf("debated", SHELF_SIZE), neuripsTrending(SHELF_SIZE)]),
  ["home-shelves"],
  { revalidate: 120 },
);
