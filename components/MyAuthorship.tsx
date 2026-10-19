"use client";
// "Papers you wrote" on My papers: connect ORCID, see the claimed papers, sync or disconnect.
import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase";
import { connectOrcid } from "./AuthorClaim";

type Me = { orcid: string; name: string | null; synced_at: string };
type Claim = { paper_id: string; papers: { id: string; title: string; year: number | null; venue: string | null } | null };

export function MyAuthorship({ session }: { session: Session }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const db = browserClient();
    const uid = session.user.id;
    db.from("orcid_accounts").select("orcid, name, synced_at").eq("user_id", uid).maybeSingle().then(({ data, error }) => setMe(error ? null : (data as Me | null)));
    db.from("paper_claims")
      .select("paper_id, papers(id, title, year, venue)")
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .then(({ data }) => setClaims((data ?? []) as unknown as Claim[]));
    const q = new URLSearchParams(window.location.search);
    const s = q.get("orcid");
    if (s)
      setNote(
        s === "connected"
          ? `ORCID connected. ${q.get("claimed") ?? 0} of your papers are claimed.`
          : s === "taken"
            ? "That ORCID iD is already connected to another Good Papers account."
            : s === "cancelled"
              ? "ORCID sign-in was cancelled."
              : "Couldn't connect ORCID. Try again.",
      );
  }, [session]);

  async function connect() {
    setBusy(true);
    const err = await connectOrcid(session.access_token, "/me");
    if (err) {
      setNote(err);
      setBusy(false);
    }
  }
  async function sync() {
    setBusy(true);
    const r = await fetch("/api/orcid/sync", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
    const j = (await r.json().catch(() => ({}))) as { claimed?: number; error?: string };
    if (j.error) {
      setNote(j.error);
      setBusy(false);
      return;
    }
    window.location.reload();
  }
  async function disconnect() {
    if (!confirm("Disconnect ORCID and remove all your author claims?")) return;
    setBusy(true);
    const db = browserClient();
    await db.from("paper_claims").delete().eq("user_id", session.user.id);
    await db.from("orcid_accounts").delete().eq("user_id", session.user.id);
    window.location.reload();
  }
  async function unclaim(id: string) {
    await browserClient().from("paper_claims").delete().eq("user_id", session.user.id).eq("paper_id", id);
    setClaims((c) => c.filter((x) => x.paper_id !== id));
  }

  if (me === undefined) return null;
  return (
    <section className="authorship">
      <h2>Papers you wrote</h2>
      {note && <p className="claim-note" role="status">{note}</p>}
      {!me ? (
        <p className="authorship-intro">
          Connect your ORCID iD and we&apos;ll mark the papers on your ORCID record as yours: a verified-author tick on
          each paper page, and your votes on your own papers set aside from the score.{" "}
          <button className="claim-btn" onClick={connect} disabled={busy}>Verify with ORCID</button>
        </p>
      ) : (
        <>
          <p className="authorship-intro">
            Verified as{" "}
            <a href={`https://orcid.org/${me.orcid}`} target="_blank" rel="noopener noreferrer">{me.name ?? me.orcid}</a>{" "}
            <span className="authorship-id">({me.orcid})</span>.{" "}
            <button className="link-button" onClick={sync} disabled={busy}>Check ORCID again</button>
            {" · "}
            <button className="link-button" onClick={disconnect} disabled={busy}>Disconnect</button>
          </p>
          {claims.length === 0 ? (
            <p className="empty">None of the papers on your ORCID record are on Good Papers yet. Search for one to add it, then check again.</p>
          ) : (
            <ul className="authorship-list">
              {claims.map((c) =>
                c.papers ? (
                  <li key={c.paper_id}>
                    <Link href={`/paper/${c.papers.id}`}>{c.papers.title}</Link>
                    <span className="paper-meta">{[c.papers.venue, c.papers.year].filter(Boolean).join(", ")}</span>
                    <button className="link-button" onClick={() => unclaim(c.paper_id)}>Not mine</button>
                  </li>
                ) : null,
              )}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
