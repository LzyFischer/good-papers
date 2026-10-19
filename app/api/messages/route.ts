// Messages between matched authors. GET ?with=<user id>: the conversation (and marks it
// read); POST { to, body }: send one. Only mutual matches with no block either way can send
// (lib/matches.ts isMatch); at most 30 messages an hour.
import { NextResponse } from "next/server";
import { authedUser } from "@/lib/authed";
import { isMatch } from "@/lib/matches";

const UUID = /^[0-9a-f-]{36}$/i;
const PER_HOUR = 30;

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const other = new URL(req.url).searchParams.get("with") ?? "";
  if (!UUID.test(other)) return NextResponse.json({ error: "Who with?" }, { status: 400 });
  const { db, uid } = me;
  const [{ data: messages }, { data: who }, canSend] = await Promise.all([
    db
      .from("match_messages")
      .select("id, sender, body, created_at, read_at")
      .or(`and(sender.eq.${uid},recipient.eq.${other}),and(sender.eq.${other},recipient.eq.${uid})`)
      .order("created_at", { ascending: true })
      .limit(500),
    db.from("orcid_accounts").select("name, orcid").eq("user_id", other).maybeSingle(),
    isMatch(db, uid, other),
  ]);
  // A conversation exists only between people who matched at some point.
  if (!canSend && !(messages ?? []).length) return NextResponse.json({ error: "You two aren't a match." }, { status: 403 });
  await db.from("match_messages").update({ read_at: new Date().toISOString() }).eq("recipient", uid).eq("sender", other).is("read_at", null);
  return NextResponse.json(
    { messages: (messages ?? []).map((m) => ({ ...m, mine: m.sender === uid })), canSend, other: who ?? null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { to, body } = ((await req.json().catch(() => ({}))) as { to?: string; body?: string }) ?? {};
  const text = (body ?? "").trim();
  if (!to || !UUID.test(to)) return NextResponse.json({ error: "Who to?" }, { status: 400 });
  if (!text || text.length > 2000) return NextResponse.json({ error: "Messages are 1 to 2,000 characters." }, { status: 400 });
  const { db, uid } = me;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const [ok, { count }] = await Promise.all([
    isMatch(db, uid, to),
    db.from("match_messages").select("id", { count: "exact", head: true }).eq("sender", uid).gte("created_at", since),
  ]);
  if (!ok) return NextResponse.json({ error: "You can only message your matches." }, { status: 403 });
  if ((count ?? 0) >= PER_HOUR) return NextResponse.json({ error: "That's a lot of messages. Try again in a while." }, { status: 429 });
  const { data, error } = await db.from("match_messages").insert({ sender: uid, recipient: to, body: text }).select("id, sender, body, created_at, read_at").single();
  if (error) return NextResponse.json({ error: "Your message wasn't sent." }, { status: 500 });
  return NextResponse.json({ message: { ...data, mine: true } });
}
