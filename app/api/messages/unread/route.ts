// GET: unread messages for the signed-in reader, by sender.
import { NextResponse } from "next/server";
import { authedUser } from "@/lib/authed";

export async function GET(req: Request) {
  const me = await authedUser(req);
  if (!me) return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  const { data } = await me.db.from("match_messages").select("sender").eq("recipient", me.uid).is("read_at", null).limit(1000);
  const bySender: Record<string, number> = {};
  for (const m of data ?? []) bySender[m.sender] = (bySender[m.sender] ?? 0) + 1;
  return NextResponse.json({ total: (data ?? []).length, bySender }, { headers: { "Cache-Control": "private, no-store" } });
}
