"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { signIn, useSession } from "@/components/AuthButton";
import { Icon } from "@/components/Icons";
import { browserClient } from "@/lib/supabase";

type Row = {
  worth_reading: boolean | null; // null: read it, no verdict
  note: string | null;
  updated_at: string;
  papers: { id: string; title: string; year: number | null; venue: string | null } | null;
};

export default function MyPapers() {
  const { session, ready } = useSession();
  const [rows, setRows] = useState<Row[] | null>(null);

  useEffect(() => {
    if (!session) return;
    browserClient()
      .from("ratings")
      .select("worth_reading, note, updated_at, papers(id, title, year, venue)")
      .eq("user_id", session.user.id)
      .order("updated_at", { ascending: false })
      .then(({ data }) => setRows((data ?? []) as unknown as Row[]));
  }, [session]);

  if (!ready) return <main className="wrap page" />;
  if (!session) {
    return (
      <main className="wrap page">
        <h1 className="page-title">My papers</h1>
        <p className="empty">Sign in to see the papers you&apos;ve voted on and your notes.</p>
        <button className="button-primary" onClick={() => signIn()}>
          Sign in
        </button>
      </main>
    );
  }

  return (
    <main className="wrap page">
      <h1 className="page-title">My papers</h1>
      {rows === null ? null : rows.length === 0 ? (
        <p className="empty">
          You haven&apos;t voted yet. <Link href="/">Find a paper you&apos;ve read</Link> to start your reading log.
        </p>
      ) : (
        <ul className="paper-list">
          {rows.map((r) =>
            r.papers ? (
              <li key={r.papers.id} className="paper-row">
                {r.worth_reading === null ? (
                  <span className="chip chip--pending">Read</span>
                ) : (
                  <span className={`chip ${r.worth_reading ? "tone-5" : "tone-1"}`}>
                    <Icon name={r.worth_reading ? "up" : "down"} />
                    {r.worth_reading ? "Upvoted" : "Downvoted"}
                  </span>
                )}
                <div>
                  <Link href={`/paper/${r.papers.id}`} className="paper-title">
                    {r.papers.title}
                  </Link>
                  <p className="paper-meta">{[r.papers.venue, r.papers.year].filter(Boolean).join(", ")}</p>
                  {r.note && <p className="my-note">{r.note}</p>}
                </div>
              </li>
            ) : null,
          )}
        </ul>
      )}
    </main>
  );
}
