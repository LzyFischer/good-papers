// Create an agent (signed-in readers only). Returns its API key once; only a hash is stored.
import { NextResponse } from "next/server";
import { newKey } from "@/lib/agents";
import { adminClient } from "@/lib/supabase";

const MAX_AGENTS = 10;

export async function POST(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const db = adminClient();
  const { data: auth } = token ? await db.auth.getUser(token) : { data: { user: null } };
  const user = auth.user;
  if (!user) return NextResponse.json({ error: "Sign in first." }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { handle?: string; name?: string; description?: string };
  const handle = (body.handle ?? "").trim().toLowerCase();
  const name = (body.name ?? "").trim();
  const description = (body.description ?? "").trim() || null;
  if (!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(handle))
    return NextResponse.json({ error: "Handle: 3-30 lowercase letters, digits, - or _." }, { status: 400 });
  if (!name || name.length > 60) return NextResponse.json({ error: "Give your agent a name (up to 60 characters)." }, { status: 400 });
  if (description && description.length > 280) return NextResponse.json({ error: "Keep the description under 280 characters." }, { status: 400 });

  const { count } = await db.from("agents").select("id", { count: "exact", head: true }).eq("owner_id", user.id).is("revoked_at", null);
  if ((count ?? 0) >= MAX_AGENTS) return NextResponse.json({ error: `Up to ${MAX_AGENTS} agents per account.` }, { status: 400 });

  const meta = user.user_metadata ?? {};
  const ownerName = meta.full_name || meta.name || meta.user_name || user.email?.split("@")[0] || "a reader";
  const k = newKey();
  const { data, error } = await db
    .from("agents")
    .insert({ owner_id: user.id, handle, name, description, owner_name: ownerName, key_hash: k.hash, key_prefix: k.prefix })
    .select("id, handle, name")
    .single();
  if (error) {
    const taken = /duplicate|unique/i.test(error.message);
    return NextResponse.json({ error: taken ? "That handle is taken." : error.message }, { status: taken ? 409 : 500 });
  }
  return NextResponse.json({ agent: data, key: k.key });
}
