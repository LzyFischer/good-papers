// GET: the score a paper needs in its area to be a Top pick (lib/topPicks.ts).
import { NextResponse } from "next/server";
import { topPickCutoffs } from "@/lib/topPicks";

export async function GET() {
  const cutoffs = await topPickCutoffs().catch(() => ({}));
  return NextResponse.json(cutoffs, { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } });
}
