// More cards for the home hero deck once the first ones run out: recent, rated ML papers,
// newest first, a page at a time. Shared by every visitor, so each page is cached.
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import { toDeckCard } from "@/lib/deck";
import { serverClient } from "@/lib/supabase";
import type { Score } from "@/lib/types";

const PAGE = 12;
const MAX_PAGES = 40;

const page = unstable_cache(
  async (n: number) => {
    const from = new Date(Date.now() - 120 * 86400_000).toISOString().slice(0, 10);
    const { data } = await serverClient()
      .from("paper_scores")
      .select("*")
      .not("score", "is", null)
      .not("area", "is", null)
      .is("conf_track", null)
      .gte("published_on", from)
      .order("published_on", { ascending: false })
      .order("id")
      .range(n * PAGE, n * PAGE + PAGE - 1);
    return ((data ?? []) as Score[]).map((s) => toDeckCard(s, "Recently out"));
  },
  ["deck-page"],
  { revalidate: 900 },
);

export async function GET(req: Request) {
  const n = Math.max(0, Math.min(MAX_PAGES, Number(new URL(req.url).searchParams.get("page")) || 0));
  const cards = await page(n).catch(() => []);
  return NextResponse.json({ cards, more: cards.length === PAGE && n < MAX_PAGES }, { headers: { "Cache-Control": "public, s-maxage=900" } });
}
