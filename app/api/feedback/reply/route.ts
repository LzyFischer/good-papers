// POST /api/feedback/reply { id, body }: the owner answers a Contact-page message by email,
// from the site's own address (Resend). Replies to it go to FEEDBACK_REPLY_TO (the same
// address by default, forwarded to the owner's inbox). Owner only (lib/admin.ts).
// Needs RESEND_API_KEY (a sending-only key) and the goodpapers.org domain verified in Resend.
import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { authedUser } from "@/lib/authed";

const FROM = process.env.FEEDBACK_FROM ?? "Good Papers <hello@goodpapers.org>";
const REPLY_TO = process.env.FEEDBACK_REPLY_TO ?? "hello@goodpapers.org";

export async function POST(req: Request) {
  const me = await authedUser(req);
  if (!me || !isAdmin(me.uid)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ error: "RESEND_API_KEY isn't set." }, { status: 500 });
  const { id, body } = ((await req.json().catch(() => ({}))) as { id?: string; body?: string }) ?? {};
  const text = (body ?? "").trim();
  if (!id || !/^[0-9a-f-]{36}$/i.test(id) || !text || text.length > 8000) return NextResponse.json({ error: "Write a reply first." }, { status: 400 });

  const { data: msg } = await me.db.from("feedback").select("email, body, created_at").eq("id", id).maybeSingle();
  if (!msg?.email) return NextResponse.json({ error: "This message has no email to reply to." }, { status: 400 });

  // The reader's message, quoted below the reply, so they know what it answers.
  const when = new Date(msg.created_at).toUTCString().replace(/ GMT$/, " UTC");
  const quoted = `\n\n---\nOn ${when} you wrote:\n\n${String(msg.body).split("\n").map((l) => `> ${l}`).join("\n")}`;
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: FROM, to: [msg.email], reply_to: REPLY_TO, subject: "Re: your message to Good Papers", text: text + quoted }),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) {
    const why = res ? ((await res.json().catch(() => null)) as { message?: string } | null)?.message : null;
    return NextResponse.json({ error: `Couldn't send${why ? `: ${why}` : "."}` }, { status: 502 });
  }
  const replied_at = new Date().toISOString();
  // Without migration 029 the email still goes out; it just isn't kept here.
  await me.db.from("feedback").update({ reply_body: text, replied_at, read_at: replied_at }).eq("id", id);
  return NextResponse.json({ ok: true, replied_at });
}
