// ORCID sends the reader back here after they sign in: store their verified iD, claim the
// papers on their record, and return them to where they started.
import { NextResponse } from "next/server";
import { exchangeCode, orcidConfigured, readState, syncClaims } from "@/lib/orcid";
import { adminClient } from "@/lib/supabase";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const state = readState(url.searchParams.get("state") ?? "");
  const code = url.searchParams.get("code");
  const to = (path: string, q: Record<string, string>) => NextResponse.redirect(new URL(`${path}?${new URLSearchParams(q)}`, url.origin));
  if (!orcidConfigured() || !state) return to("/me", { orcid: "failed" });
  if (!code) return to(state.back, { orcid: "cancelled" });
  const db = adminClient();
  try {
    const { orcid, name } = await exchangeCode(code, `${url.origin}/api/orcid/callback`);
    // One Good Papers account per ORCID iD.
    const { data: other } = await db.from("researchers").select("user_id").eq("orcid", orcid).maybeSingle();
    if (other && other.user_id !== state.userId) return to(state.back, { orcid: "taken" });
    await db.from("researchers").upsert({ user_id: state.userId, orcid, name, verified_at: new Date().toISOString() });
    const { claimed } = await syncClaims(db, state.userId, orcid);
    return to(state.back, { orcid: "connected", claimed: String(claimed) });
  } catch (e) {
    console.warn("ORCID connect failed:", e);
    return to(state.back, { orcid: "failed" });
  }
}
