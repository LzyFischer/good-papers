// Daily job (see vercel.json): pull Hugging Face's trending lists and the newest AI
// papers from OpenAlex, give each new one an AI panel verdict, fill in any missing
// one-line takes, refresh stored citation counts, and wake the discussion worker.
// Vercel Cron sends "Authorization: Bearer $CRON_SECRET" automatically.
import { NextResponse } from "next/server";
import { arxivCategories, arxivIdOf, isML } from "@/lib/arxiv";
import { nudgeWorker } from "@/lib/dispatch";
import { getHfTrendingPapers } from "@/lib/huggingface";
import { judgePaper, mapLimit } from "@/lib/judge";
import { getNewestPapers } from "@/lib/openalex";
import { fillMissingTakes, isAuthorized, refreshAiCurve, refreshCitations, storeJudgement, withStoredIds } from "@/lib/papers";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const max = Number(process.env.CRON_MAX_PAPERS ?? 150); // HF posts ~50-100 papers a day
  // Hugging Face's lists first (today, this week, this month, the past year), then OpenAlex's newest.
  const hf = await getHfTrendingPapers().catch((e) => {
    console.warn("Hugging Face trending failed:", e);
    return [];
  });
  const seen = new Set(hf.map((p) => p.id));
  // A paper stored as "arxiv-<id>" keeps that id when OpenAlex catches up, and vice versa.
  const fetched = await withStoredIds([...hf, ...(await getNewestPapers(3, 100)).filter((p) => !seen.has(p.id))]);
  const once = new Set<string>();
  const unique = fetched.filter((p) => {
    const k = arxivIdOf(p.url) ?? p.id;
    if (once.has(k)) return false;
    once.add(k);
    return true;
  });
  // OpenAlex's AI topic tag lets physics and math in; keep papers arXiv files under ML.
  let newest = unique;
  try {
    const cats = await arxivCategories(unique.map((p) => arxivIdOf(p.url)).filter((x): x is string => Boolean(x)));
    newest = unique.filter((p) => {
      const id = arxivIdOf(p.url);
      return !id || !cats.has(id) || isML(cats.get(id));
    });
  } catch (e) {
    console.warn("arXiv category check failed, keeping all:", e);
  }
  const { data: existing } = await serverClient()
    .from("ai_verdicts")
    .select("paper_id")
    .in("paper_id", newest.map((p) => p.id));
  const judged = new Set((existing ?? []).map((r: { paper_id: string }) => r.paper_id));
  const todo = newest.filter((p) => p.abstract && !judged.has(p.id)).slice(0, max);

  const results = await mapLimit(todo, 5, async (paper) => {
    try {
      const j = await judgePaper(paper);
      await storeJudgement(paper, j);
      return { id: paper.id, ok: true };
    } catch (e) {
      return { id: paper.id, ok: false, error: String(e) };
    }
  });
  await refreshAiCurve();
  if (results.some((r) => r.ok)) await nudgeWorker(); // discussions, TL;DRs, thumbnails for the new papers
  const takesFilled = await fillMissingTakes(5);
  const citationsRefreshed = await refreshCitations().catch((e) => String(e));

  return NextResponse.json({
    judged: results.filter((r) => r.ok).length,
    skippedNotML: unique.length - newest.length,
    fromHuggingFace: hf.length,
    results,
    takesFilled,
    citationsRefreshed,
  });
}
