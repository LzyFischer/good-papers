// NeurIPS Quest hall chat. GET ?s=<session>: the latest messages, for anyone; POST { s, body }:
// post one, signed in only, at most 30 an hour. Players show as nicknames (lib/questNames.ts),
// never user ids. Others in the hall get new messages over Supabase Realtime from the poster.
import { NextResponse } from "next/server";
import { authedUser } from "@/lib/authed";
import { nickFor } from "@/lib/questNames";
import { adminClient } from "@/lib/supabase";

const SESSION = /^(Sydney|Atlanta|Paris) Poster Session \d$/;
const PER_HOUR = 30;

export async function GET(req: Request) {
  const s = new URL(req.url).searchParams.get("s") ?? "";
  if (!SESSION.test(s)) return NextResponse.json({ error: "Which session?" }, { status: 400 });
  const { data } = await adminClient()
    .from("quest_chat")
    .select("id, nick, body, created_at")
    .eq("session", s)
    .order("created_at", { ascending: false })
    .limit(60);
  return NextResponse.json({ messages: (data ?? []).reverse() }, { headers: { "Cache-Control": "public, s-maxage=5" } });
}

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me) return NextResponse.json({ error: "Sign in to chat." }, { status: 401 });
  const { s, body } = ((await req.json().catch(() => ({}))) as { s?: string; body?: string }) ?? {};
  const text = (body ?? "").replace(/\s+/g, " ").trim();
  if (!s || !SESSION.test(s)) return NextResponse.json({ error: "Which session?" }, { status: 400 });
  if (!text || text.length > 280) return NextResponse.json({ error: "Messages are 1 to 280 characters." }, { status: 400 });
  const { db, uid } = me;
  const since = new Date(Date.now() - 3600_000).toISOString();
  const { count } = await db.from("quest_chat").select("id", { count: "exact", head: true }).eq("user_id", uid).gte("created_at", since);
  if ((count ?? 0) >= PER_HOUR) return NextResponse.json({ error: "That's a lot of messages. Try again in a while." }, { status: 429 });
  const { data, error } = await db
    .from("quest_chat")
    .insert({ session: s, user_id: uid, nick: nickFor(uid), body: text })
    .select("id, nick, body, created_at")
    .single();
  if (error) return NextResponse.json({ error: "Your message wasn't sent." }, { status: 500 });
  return NextResponse.json({ message: data });
}
