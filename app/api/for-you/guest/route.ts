// POST /api/for-you/guest {"papers": [{"id", "s", "t"}]}: For you for a visitor who isn't
// signed in, from the papers they opened on this browser (components/guestHistory.ts).
// Nothing is stored.
import { NextResponse } from "next/server";
import { affinityFromSignals, guestSignals, rankForYou } from "@/lib/forYou";
import { PAPER_ID } from "@/lib/papers";
import { serverClient } from "@/lib/supabase";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { papers?: unknown; limit?: unknown };
  const history = (Array.isArray(body.papers) ? body.papers : [])
    .filter((h): h is { id: string; s: number; t: number } =>
      !!h && typeof h.id === "string" && PAPER_ID.test(h.id) && Number.isFinite(h.s) && Number.isFinite(h.t))
    .slice(0, 60);
  if (!history.length) return NextResponse.json({ papers: [], hasTopics: false, topics: { picked: [], learned: [] }, reasons: {} });
  const limit = Math.max(1, Math.min(100, Number(body.limit) || 24));
  const db = serverClient();
  const learned = await affinityFromSignals(db, guestSignals(history));
  const out = await rankForYou(db, null, limit, { prefs: null, learned, voted: new Set(history.map((h) => h.id)) });
  return NextResponse.json(out, { headers: { "Cache-Control": "no-store" } });
}
