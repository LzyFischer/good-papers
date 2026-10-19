"use client";
// Matches: authors who read each other's papers (lib/matches.ts). Opt-in; needs papers
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

  const load = useCallback(async () => {
    if (!session) return;
    const db = browserClient();
    const [acct, opt] = await Promise.all([
      db.from("orcid_accounts").select("orcid").eq("user_id", session.user.id).maybeSingle(),
      db.from("match_optin").select("user_id").eq("user_id", session.user.id).maybeSingle(),
    ]);
    setOrcid(acct.data?.orcid ?? null);
    setOn(Boolean(opt.data));
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
        <p className="empty">Sign in to find authors who read your papers, and whose papers you read.</p>
        <button className="button-primary" onClick={() => signIn()}>Sign in</button>
      </main>
    );
  }

  return (
    <main className="wrap page matches">
      <h1 className="page-title">Matches</h1>
      <p className="page-sub">
        Authors who read your papers, and whose papers you read. Reading counts any way: a vote either way, a ♥ on the
        home page, or a minute on the paper. The more of each other&apos;s work, the closer the match.
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
        <p className="empty">No matches yet. They show up once another author who turned matching on reads your papers, and you read theirs.</p>
      )}
      {result?.status === "ok" && result.matches.length > 0 && (
        <ul className="match-list">{result.matches.map((m) => <MatchRow key={m.userId} m={m} />)}</ul>
      )}
    </main>
  );
}

function MatchRow({ m }: { m: Match }) {
  const strength = m.theyRead + m.youRead;
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
        <span className="match-strength" title="Papers read both ways">{strength} shared</span>
      </div>
      <p className="match-why">
        Read {m.theyRead} of your paper{m.theyRead === 1 ? "" : "s"} · you read {m.youRead} of theirs
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
