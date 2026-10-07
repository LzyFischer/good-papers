// Judge specific papers on demand:
// curl -X POST https://<site>/api/judge -H "Authorization: Bearer $CRON_SECRET" \
//      -H "Content-Type: application/json" -d '{"ids":["W4415..."]}'
import { NextResponse } from "next/server";
import { judgePaper } from "@/lib/judge";
import { getPaperAnywhere, isAuthorized, refreshAiCurve, storeJudgement } from "@/lib/papers";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(req: Request) {
  if (!isAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const ids: string[] = Array.isArray(body.ids) ? body.ids.slice(0, 20) : [];
  const results = [];
  for (const id of ids) {
    try {
      const paper = await getPaperAnywhere(id);
      if (!paper) {
        results.push({ id, ok: false, error: "not found" });
        continue;
      }
      const j = await judgePaper(paper);
      await storeJudgement(paper, j);
      results.push({ id, ok: true, area: j.area, fresh: j.verdicts.filter((v) => v.fresh).length });
    } catch (e) {
      results.push({ id, ok: false, error: String(e) });
    }
  }
  await refreshAiCurve();
  return NextResponse.json({ results });
}
