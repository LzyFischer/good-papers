// GET /api/for-you?limit=24 with the reader's Supabase access token: their For you list,
// ranked on the server (lib/forYou.ts) in one round trip instead of a dozen from the browser.
import { NextResponse } from "next/server";
import { rankForYou } from "@/lib/forYou";
import { adminClient } from "@/lib/supabase";

export async function GET(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const limit = Math.max(1, Math.min(100, Number(new URL(req.url).searchParams.get("limit")) || 24));
  const out = await rankForYou(db, data.user.id, limit);
  return NextResponse.json(out, { headers: { "Cache-Control": "private, no-store" } });
}
