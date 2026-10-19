// POST /api/orcid/start with the reader's Supabase token: where to send them to sign in
// with ORCID. The state ties ORCID's answer back to this reader (lib/orcid.ts).
import { NextResponse } from "next/server";
import { authorizeUrl, makeState, orcidConfigured } from "@/lib/orcid";
import { adminClient } from "@/lib/supabase";

export async function POST(req: Request) {
  if (!orcidConfigured()) return NextResponse.json({ error: "ORCID isn't set up yet." }, { status: 503 });
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data, error } = await adminClient().auth.getUser(token);
  if (error || !data.user) return NextResponse.json({ error: "Sign in again." }, { status: 401 });
  const back = ((await req.json().catch(() => ({}))) as { back?: string }).back ?? "/me";
  const origin = new URL(req.url).origin;
  return NextResponse.json({ url: authorizeUrl(`${origin}/api/orcid/callback`, makeState(data.user.id, back)) });
}
