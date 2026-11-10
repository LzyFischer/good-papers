"use client";
// The page of a paper we haven't stored yet. The server sends only this shell; the paper
// itself loads here from /api/paper-preview, so crawlers walking links into OpenAlex's
// millions of works cost nothing (Nov 2026: one took the database down). A reader who stays
// a few seconds gets it judged (WarmUp), which stores it, and from then on the page is
// rendered on the server like any other.
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { tex } from "@/lib/latex";
import type { Paper } from "@/lib/types";
import { Comments } from "./Comments";
import { NoteBox } from "./NoteBox";
import { PaperHero } from "./PaperHero";
import { ReadTracker } from "./ReadTracker";
import { WarmUp } from "./WarmUp";

export function UnstoredPaper({ id }: { id: string }) {
  const router = useRouter();
  const [paper, setPaper] = useState<Paper | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    fetch(`/api/paper-preview/${encodeURIComponent(id)}`)
      .then((r) => (r.ok ? r.json() : { paper: null }))
      .then((j: { paper: Paper | null; redirect?: string | null }) => {
        if (!live) return;
        if (j.redirect) return router.replace(`/paper/${j.redirect}`);
        setPaper(j.paper);
        if (j.paper) document.title = `${tex(j.paper.title)} | Good Papers`;
      })
      .catch(() => live && setPaper(null));
    return () => {
      live = false;
    };
  }, [id, router]);

  if (paper === undefined) return <main className="wrap page paper-page"><p className="warmup">Loading paper…</p></main>;
  if (paper === null)
    return (
      <main className="wrap page paper-page">
        <h1>Paper not found</h1>
        <p>We couldn&apos;t find this paper. Try searching for its title.</p>
      </main>
    );
  return (
    <main className="wrap page paper-page">
      <PaperHero paper={paper} score={null} verdicts={[]} />
      <NoteBox paperId={paper.id} />
      <ReadTracker paperId={paper.id} />
      {paper.abstract && <WarmUp id={paper.id} unjudged />}
      <div className="paper-cols">
        {paper.abstract && (
          <section className="abstract">
            <h2>Abstract</h2>
            <p>{tex(paper.abstract)}</p>
          </section>
        )}
        <Comments paper={{ id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, url: paper.url }} />
      </div>
    </main>
  );
}
