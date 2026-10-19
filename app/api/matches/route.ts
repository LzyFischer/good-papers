// GET /api/matches with the reader's Supabase token: their matches (lib/matches.ts).
import { NextResponse } from "next/server";
import { matchesFor } from "@/lib/matches";
import { adminClient } from "@/lib/supabase";

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const out = await matchesFor(db, data.user.id).catch((e) => {
    console.warn("matches failed:", e);
    return null;
  });
  if (!out) return NextResponse.json({ error: "Couldn't load matches. Try again." }, { status: 500 });
  return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
}
