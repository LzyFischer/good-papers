"use client";
// "Are you an author?": verified authors of a paper, and the reader's own claim. Claims come
// only from a verified ORCID record (lib/orcid.ts), so there's no "claim" button that takes
// anyone's word for it: the reader connects ORCID, and the papers on their record are claimed.
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase";
import { signIn, useSession } from "./AuthButton";

export type VerifiedAuthor = { name: string | null; orcid: string; userId: string };

// Send a signed-in reader to ORCID; they come back to `back`.
export async function connectOrcid(token: string, back: string): Promise<string | null> {
  const r = await fetch("/api/orcid/start", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ back }),
  });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (j.url) {
    window.location.href = j.url;
    return null;
  }
  return j.error ?? "Couldn't reach ORCID. Try again.";
}

export function AuthorClaim({ paperId, authors }: { paperId: string; authors: VerifiedAuthor[] }) {
  const { session } = useSession();
  const [orcid, setOrcid] = useState<string | null | undefined>(undefined); // undefined: loading
  const [mine, setMine] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!session) return;
    const db = browserClient();
    db.from("researchers").select("orcid").eq("user_id", session.user.id).maybeSingle().then(({ data }) => setOrcid(data?.orcid ?? null));
    setMine(authors.some((a) => a.userId === session.user.id));
  }, [session, authors]);

  // Back from ORCID: say what happened.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get("orcid");
    if (!s) return;
    setNote(
      s === "connected"
        ? `ORCID connected. ${q.get("claimed") ?? 0} of your papers are claimed.`
        : s === "taken"
          ? "That ORCID iD is already connected to another Good Papers account."
          : s === "cancelled"
            ? "ORCID sign-in was cancelled."
            : "Couldn't connect ORCID. Try again.",
    );
  }, []);

  async function connect() {
    if (!session) return signIn();
    setBusy(true);
    const err = await connectOrcid(session.access_token, window.location.pathname);
    if (err) {
      setNote(err);
      setBusy(false);
    }
  }

  async function sync() {
    if (!session) return;
    setBusy(true);
    const r = await fetch("/api/orcid/sync", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}` } });
    const j = (await r.json().catch(() => ({}))) as { claimed?: number; error?: string };
    setBusy(false);
    if (j.error) return setNote(j.error);
    window.location.reload();
  }

  async function unclaim() {
    if (!session) return;
    setBusy(true);
    await browserClient().from("paper_claims").delete().eq("user_id", session.user.id).eq("paper_id", paperId);
    window.location.reload();
  }

  return (
    <div className="claim">
      {authors.length > 0 && (
        <p className="claim-authors">
          <span className="claim-check" aria-hidden="true">✓</span>
          Verified author{authors.length === 1 ? "" : "s"}:{" "}
          {authors.map((a, k) => (
            <span key={a.orcid}>
              {k ? ", " : ""}
              <a href={`https://orcid.org/${a.orcid}`} target="_blank" rel="noopener noreferrer nofollow">{a.name ?? a.orcid}</a>
            </span>
          ))}
        </p>
      )}
      <p className="claim-action">
        {mine ? (
          <>
            You&apos;re a verified author of this paper.{" "}
            <button className="link-button" onClick={unclaim} disabled={busy}>Remove my claim</button>
          </>
        ) : session && orcid ? (
          <>
            Your paper? It isn&apos;t on your ORCID record yet. Add it there, then{" "}
            <button className="link-button" onClick={sync} disabled={busy}>check again</button>.
          </>
        ) : (
          <>
            Are you an author?{" "}
            <button className="claim-btn" onClick={connect} disabled={busy || (session !== null && orcid === undefined)}>
              Verify with ORCID
            </button>
          </>
        )}
      </p>
      {note && <p className="claim-note" role="status">{note}</p>}
    </div>
  );
}
