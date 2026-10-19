// The owner's feedback inbox. GET ?count=1: just the unread count; GET: the latest 100
// messages. POST { read: [ids] }: mark them read. Owner only (lib/admin.ts).
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { authedUser } from "@/lib/authed";

const noStore = { headers: { "Cache-Control": "private, no-store" } };

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me || !isAdmin(me.uid)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { count } = await me.db.from("feedback").select("id", { count: "exact", head: true }).is("read_at", null);
  if (new URL(req.url).searchParams.get("count")) return NextResponse.json({ unread: count ?? 0 }, noStore);
  const { data } = await me.db
    .from("feedback")
    .select("id, created_at, kind, body, email, page, user_id, read_at")
    .order("created_at", { ascending: false })
    .limit(100);
  return NextResponse.json({ unread: count ?? 0, items: data ?? [] }, noStore);
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me || !isAdmin(me.uid)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { read } = ((await req.json().catch(() => ({}))) as { read?: string[] }) ?? {};
  const ids = (read ?? []).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 200);
  if (ids.length) await me.db.from("feedback").update({ read_at: new Date().toISOString() }).in("id", ids).is("read_at", null);
  return NextResponse.json({ ok: true });
}
