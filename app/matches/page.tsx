"use client";
// Matches: authors who voted on each other's papers (lib/matches.ts). Opt-in; needs papers
// claimed through ORCID. Only mutual matches show, and never which way anyone voted.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { signIn, useSession } from "@/components/AuthButton";
import { connectOrcid } from "@/components/orcidClient";
import type { Match, MatchesResult } from "@/lib/matches";
import { browserClient } from "@/lib/supabase";

export default function MatchesPage() {
  const { session, ready } = useSession();
  const [orcid, setOrcid] = useState<string | null | undefined>(undefined);
  const [on, setOn] = useState<boolean | undefined>(undefined);
  const [result, setResult] = useState<MatchesResult | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unread, setUnread] = useState<Record<string, number>>({});

  const load = useCallback(async () => {
    if (!session) return;
    const db = browserClient();
    const [acct, opt] = await Promise.all([
      db.from("orcid_accounts").select("orcid").eq("user_id", session.user.id).maybeSingle(),
      db.from("match_optin").select("user_id").eq("user_id", session.user.id).maybeSingle(),
    ]);
    setOrcid(acct.data?.orcid ?? null);
    setOn(Boolean(opt.data));
    fetch("/api/messages/unread", { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then((u) => (u.ok ? u.json() : null))
      .then((u: { bySender: Record<string, number> } | null) => u && setUnread(u.bySender))
      .catch(() => {});
    const r = await fetch("/api/matches", { headers: { Authorization: `Bearer ${session.access_token}` } });
    const j = (await r.json().catch(() => null)) as MatchesResult | { error: string } | null;
    if (j && "status" in j) setResult(j);
    else setNote(j?.error ?? "Couldn't load matches.");
  }, [session]);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle() {
    if (!session) return;
    setBusy(true);
    const db = browserClient();
    const { error } = on
      ? await db.from("match_optin").delete().eq("user_id", session.user.id)
      : await db.from("match_optin").insert({ user_id: session.user.id });
    setBusy(false);
    if (error) return setNote(error.message);
    await load();
  }

  if (!ready) return <main className="wrap page" />;
  if (!session) {
    return (
      <main className="wrap page">
        <h1 className="page-title">Matches</h1>
        <p className="empty">Sign in to find authors who voted on your papers, and whose papers you voted on.</p>
        <button className="button-primary" onClick={() => signIn()}>Sign in</button>
      </main>
    );
  }

  return (
    <main className="wrap page matches">
      <h1 className="page-title">Matches</h1>
      <p className="page-sub">
        Authors who voted on your papers, and whose papers you voted on, either way. The more of each other&apos;s work,
        the closer the match. Matches can message each other.
      </p>

      <section className="match-switch">
        <div>
          <b>Matching is {on ? "on" : "off"}</b>
          <p>
            Only readers who turn this on take part. A match shows only when it goes both ways, and nobody ever sees how
            anyone voted.
          </p>
        </div>
        {orcid === null ? (
          <button className="claim-btn" disabled={busy} onClick={() => connectOrcid(session.access_token, "/matches").then((e) => e && setNote(e))}>
            Verify with ORCID first
          </button>
        ) : (
          <button className={`switch ${on ? "switch--on" : ""}`} role="switch" aria-checked={Boolean(on)} disabled={busy || on === undefined} onClick={toggle}>
            <span />
          </button>
        )}
      </section>
      {note && <p className="claim-note" role="status">{note}</p>}

      {result?.status === "no-claims" && (
        <p className="empty">
          None of your papers are claimed yet. <Link href="/me">Check your ORCID papers</Link>; matches need your papers on Good Papers.
        </p>
      )}
      {result?.status === "ok" && result.matches.length === 0 && (
        <p className="empty">No matches yet. They show up once another author who turned matching on votes on your papers, and you vote on theirs.</p>
      )}
      {result?.status === "ok" && result.matches.length > 0 && (
        <ul className="match-list">{result.matches.map((m) => <MatchRow key={m.userId} m={m} unread={unread[m.userId] ?? 0} />)}</ul>
      )}
    </main>
  );
}

function MatchRow({ m, unread }: { m: Match; unread: number }) {
  const strength = m.theyVoted + m.youVoted;
  return (
    <li className="match">
      <div className="match-top">
        <span className="match-name">
          {m.orcid ? (
            <a href={`https://orcid.org/${m.orcid}`} target="_blank" rel="noopener noreferrer">{m.name ?? m.orcid}</a>
          ) : (
            m.name ?? "An author"
          )}
        </span>
        <span className="match-strength" title="Papers voted on both ways">{strength} shared</span>
        <Link href={`/matches/${m.userId}`} className="match-chat">
          Message{unread > 0 && <span className="match-unread">{unread}</span>}
        </Link>
      </div>
      <p className="match-why">
        Voted on {m.theyVoted} of your paper{m.theyVoted === 1 ? "" : "s"} · you voted on {m.youVoted} of theirs
      </p>
      {m.papers.length > 0 && (
        <ul className="match-papers">
          {m.papers.map((p) => (
            <li key={p.id}><Link href={`/paper/${p.id}`}>{p.title}</Link></li>
          ))}
        </ul>
      )}
    </li>
  );
}
