// Daily job (see vercel.json): pull the newest AI papers from OpenAlex,
// give each an AI panel verdict, fill in any missing one-line takes, and
// refresh stored citation counts.
// Vercel Cron sends "Authorization: Bearer $CRON_SECRET" automatically.
import { NextResponse } from "next/server";
import { judgePaper, mapLimit } from "@/lib/judge";
import { getNewestPapers } from "@/lib/openalex";
import { fillMissingTakes, isAuthorized, refreshCitations, storeJudgement } from "@/lib/papers";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const max = Number(process.env.CRON_MAX_PAPERS ?? 50);
  const newest = await getNewestPapers(3, 100);
  const { data: existing } = await serverClient()
    .from("ai_verdicts")
    .select("paper_id")
    .in("paper_id", newest.map((p) => p.id));
  const judged = new Set((existing ?? []).map((r: { paper_id: string }) => r.paper_id));
  const todo = newest.filter((p) => p.abstract && !judged.has(p.id)).slice(0, max);

  const results = await mapLimit(todo, 3, async (paper) => {
    try {
      const j = await judgePaper(paper);
      await storeJudgement(paper, j);
      return { id: paper.id, ok: true };
    } catch (e) {
      return { id: paper.id, ok: false, error: String(e) };
    }
  });
  const takesFilled = await fillMissingTakes(5);
  const citationsRefreshed = await refreshCitations().catch((e) => String(e));

  return NextResponse.json({ judged: results.filter((r) => r.ok).length, results, takesFilled, citationsRefreshed });
}
