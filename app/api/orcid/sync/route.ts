// POST /api/orcid/sync with the reader's Supabase token: read their ORCID record again and
// claim any new papers on it (after they add a paper to ORCID, or we add the paper here).
import { NextResponse } from "next/server";
import { syncClaims } from "@/lib/orcid";
import { adminClient } from "@/lib/supabase";

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const { data: me } = await db.from("orcid_accounts").select("orcid, synced_at").eq("user_id", data.user.id).maybeSingle();
  if (!me) return NextResponse.json({ error: "Connect your ORCID iD first." }, { status: 400 });
  // At most once a minute: each sync reads ORCID and OpenAlex.
  if (Date.now() - new Date(me.synced_at).getTime() < 60_000) return NextResponse.json({ error: "Synced a moment ago. Try again in a minute." }, { status: 429 });
  const { claimed } = await syncClaims(db, data.user.id, me.orcid);
  return NextResponse.json({ claimed });
}
