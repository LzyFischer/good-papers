// POST /api/warm {"id": "..."}: what a paper page needs once a reader is actually looking
// at it (components/WarmUp.tsx calls it after a few visible seconds, so crawlers that grab
// the HTML don't set it off):
//   - a paper with no AI verdicts yet gets judged by the panel (inside the hourly budget);
//   - a bulk-imported conference paper gets its AI discussion queued.
import { NextResponse } from "next/server";
import { nudgeWorker } from "@/lib/dispatch";
import { jevConfigured } from "@/lib/jev";
import { judgePaper } from "@/lib/judge";
import { getPaperAnywhere, getVerdicts, PAPER_ID, refreshAiCurve, storeJudgement, underInlineBudget } from "@/lib/papers";
import { adminClient } from "@/lib/supabase";

export const maxDuration = 60;

const BOT = /bot|crawl|spider|slurp|headless|lightpanda|python|curl|wget|httpx|axios|scrapy|go-http/i;

export async function POST(req: Request) {
  if (BOT.test(req.headers.get("user-agent") ?? "")) return NextResponse.json({ judged: false });
  const { id } = (await req.json().catch(() => ({}))) as { id?: string };
  if (!id || !PAPER_ID.test(id) || !process.env.SUPABASE_SERVICE_ROLE_KEY) return NextResponse.json({ judged: false });

  let judged = false;
  const verdicts = (await getVerdicts([id])).get(id) ?? [];
  if (verdicts.length === 0 && jevConfigured() && (await underInlineBudget())) {
    const paper = await getPaperAnywhere(id);
    if (paper?.abstract) {
      try {
        await storeJudgement(paper, await judgePaper(paper, { withTakes: false }));
        await refreshAiCurve(); // the reader is waiting for this score
        judged = true;
      } catch (e) {
        console.warn("Judging on view failed:", e);
      }
    }
  }

  // Conference papers imported in bulk get their AI discussion once someone opens them.
  const db = adminClient();
  const { data: flags } = await db.from("papers").select("discuss_on_demand, discuss_requested_at").eq("id", id).maybeSingle();
  const discuss = !!flags?.discuss_on_demand && !flags.discuss_requested_at;
  if (discuss) await db.from("papers").update({ discuss_requested_at: new Date().toISOString() }).eq("id", id);
  // AI discussion, TL;DR and consensus follow in a few minutes.
  if (judged || discuss) await nudgeWorker();

  return NextResponse.json({ judged });
}
