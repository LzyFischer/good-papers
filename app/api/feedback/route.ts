// POST /api/feedback { kind, body, email?, page?, website? }: a message from the Contact page.
// Stored for the owner (migration 026). "website" is a honeypot field that people never see;
// bots fill it. At most 5 messages an hour from one address.
import { createHash } from "crypto";
import { NextResponse } from "next/server";
import { adminClient } from "@/lib/supabase";

const KINDS = ["bug", "score", "idea", "other"];

export async function POST(req: Request) {
  const j = (await req.json().catch(() => ({}))) as { kind?: string; body?: string; email?: string; page?: string; website?: string };
  if (j.website) return NextResponse.json({ ok: true }); // a bot: pretend it worked
  const body = (j.body ?? "").trim();
  if (!body) return NextResponse.json({ error: "Write a message first." }, { status: 400 });
  if (body.length > 4000) return NextResponse.json({ error: "That's over 4,000 characters. Please shorten it." }, { status: 400 });
  const email = (j.email ?? "").trim().slice(0, 200) || null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "That email address doesn't look right." }, { status: 400 });

  const db = adminClient();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim();
  const ip_hash = ip ? createHash("sha256").update(ip + (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")).digest("hex").slice(0, 32) : null;
  if (ip_hash) {
    const since = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await db.from("feedback").select("id", { count: "exact", head: true }).eq("ip_hash", ip_hash).gte("created_at", since);
    if ((count ?? 0) >= 5) return NextResponse.json({ error: "Thanks, we've had a few messages from you this hour. Try again later." }, { status: 429 });
  }
  let user_id: string | null = null;
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (token) user_id = (await db.auth.getUser(token)).data.user?.id ?? null;

  const { error } = await db.from("feedback").insert({
    kind: KINDS.includes(j.kind ?? "") ? j.kind : "other",
    body,
    email,
    page: (j.page ?? "").slice(0, 300) || null,
    user_id,
    ip_hash,
  });
  if (error) return NextResponse.json({ error: "Your message wasn't sent. Try again in a moment." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
