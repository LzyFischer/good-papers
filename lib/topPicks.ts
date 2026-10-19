// "Top pick": the top 5% of rated papers in each research area (lib/areas.ts). Worked out
// once an hour from every paper's score, as one score cut-off per area, and served as a small
// cached JSON (app/api/top-picks) that the badges read (components/TopPick.tsx). Areas with
// fewer than MIN_PAPERS papers get none, and a Top pick is always at least Highly rated.
import { unstable_cache } from "next/cache";
import { serverClient } from "./supabase";

const SHARE = 0.05;
const MIN_PAPERS = 20;
const FLOOR = 0.65; // Highly rated

export const topPickCutoffs = unstable_cache(
  async (): Promise<Record<string, number>> => {
    const db = serverClient();
    const byArea = new Map<string, number[]>();
    for (let from = 0; from < 50_000; from += 1000) {
      const { data, error } = await db
        .from("paper_scores")
        .select("area, score")
        .not("score", "is", null)
        .not("area", "is", null)
        .order("id")
        .range(from, from + 999);
      if (error) break;
      for (const r of (data ?? []) as { area: string; score: number }[]) {
        const list = byArea.get(r.area);
        if (list) list.push(r.score);
        else byArea.set(r.area, [r.score]);
      }
      if (!data || data.length < 1000) break;
    }
    const out: Record<string, number> = {};
    for (const [area, scores] of byArea) {
      if (scores.length < MIN_PAPERS) continue;
      scores.sort((a, b) => b - a);
      out[area] = Math.max(FLOOR, scores[Math.max(0, Math.ceil(scores.length * SHARE) - 1)]);
    }
    return out;
  },
  ["top-pick-cutoffs"],
  { revalidate: 3600 },
);
