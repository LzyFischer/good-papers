// More cards for the home hero deck once the first ones run out, a page at a time: a mix of
// this month's trending, this year's highest rated and the newest papers, so it doesn't turn
// into a feed of whatever came out today. Shared by every visitor, so each page is cached.
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { toDeckCard, type DeckCard } from "@/lib/deck";
import { serverClient } from "@/lib/supabase";
import { trending } from "@/lib/trending";
import type { Score } from "@/lib/types";

const EACH = 4; // cards per source per page
const MAX_PAGES = 40;
const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString().slice(0, 10);

const trendingMonth = unstable_cache(() => trending("month", 160), ["deck-trending-month"], { revalidate: 900 });

async function ranked(n: number, kind: "top" | "new"): Promise<Score[]> {
  let q = serverClient().from("paper_scores").select("*").not("score", "is", null).not("area", "is", null).is("conf_track", null);
  q = kind === "top" ? q.gte("published_on", daysAgo(365)).order("score", { ascending: false }) : q.gte("published_on", daysAgo(120)).order("published_on", { ascending: false });
  const { data } = await q.order("id").range(n * EACH, n * EACH + EACH - 1);
  return (data ?? []) as Score[];
}

const page = unstable_cache(
  async (n: number) => {
    const [hot, top, fresh] = await Promise.all([
      trendingMonth().then((all) => all.slice(n * EACH, n * EACH + EACH)).catch(() => [] as Score[]),
      ranked(n, "top").catch(() => [] as Score[]),
      ranked(n, "new").catch(() => [] as Score[]),
    ]);
    const lists: [Score[], string][] = [[hot, "Trending this month"], [top, "Highly rated this year"], [fresh, "Recently out"]];
    const cards: DeckCard[] = [];
    for (let k = 0; k < EACH; k++) for (const [list, kicker] of lists) if (list[k]) cards.push(toDeckCard(list[k], kicker));
    return { cards, more: lists.some(([l]) => l.length === EACH) };
  },
  ["deck-page-mix"],
  { revalidate: 900 },
);

export async function GET(req: Request) {
  const n = Math.max(0, Math.min(MAX_PAGES, Number(new URL(req.url).searchParams.get("page")) || 0));
  const { cards, more } = await page(n).catch(() => ({ cards: [] as DeckCard[], more: false }));
  return NextResponse.json({ cards, more: more && n < MAX_PAGES }, { headers: { "Cache-Control": "public, s-maxage=900" } });
}
