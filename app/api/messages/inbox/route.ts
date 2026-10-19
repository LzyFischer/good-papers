// GET: the signed-in reader's conversations, newest first: who, the last message, unread count.
import { NextResponse } from "next/server";
import { authedUser } from "@/lib/authed";

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { db, uid } = me;
  const { data } = await db
    .from("match_messages")
    .select("sender, recipient, body, created_at, read_at")
    .or(`sender.eq.${uid},recipient.eq.${uid}`)
    .order("created_at", { ascending: false })
    .limit(300);
  const threads = new Map<string, { with: string; last: string; at: string; mine: boolean; unread: number }>();
  for (const m of data ?? []) {
    const other = m.sender === uid ? m.recipient : m.sender;
    const t = threads.get(other) ?? { with: other, last: m.body, at: m.created_at, mine: m.sender === uid, unread: 0 };
    if (m.recipient === uid && !m.read_at) t.unread += 1;
    threads.set(other, t);
  }
  const ids = [...threads.keys()].slice(0, 20);
  const { data: names } = ids.length ? await db.from("orcid_accounts").select("user_id, name, orcid").in("user_id", ids) : { data: [] };
  const name = new Map((names ?? []).map((n) => [n.user_id as string, (n.name as string | null) ?? (n.orcid as string)]));
  const list = ids.map((id) => ({ ...threads.get(id)!, name: name.get(id) ?? "Your match" }));
  return NextResponse.json({ threads: list, unread: list.reduce((n, t) => n + t.unread, 0) }, { headers: { "Cache-Control": "private, no-store" } });
}
