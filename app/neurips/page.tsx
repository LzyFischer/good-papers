import type { Metadata } from "next";
import Link from "next/link";
import { PaperCard } from "@/components/PaperCard";
import { MiniCard } from "@/components/Shelf";
import { NEURIPS, TRACKS, bestBySession, sessionPapers, sessionWhen, trackPapers, type Track } from "@/lib/neurips";
import { getVerdicts } from "@/lib/papers";
import type { Score } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "NeurIPS 2026",
  description: "Every NeurIPS 2026 paper, rated: the best orals, spotlights and posters in every session.",
};

type Props = { searchParams: Promise<{ track?: string; session?: string; n?: string }> };
const PAGE = 40;

function Tabs({ track }: { track: Track | null }) {
  return (
    <nav className="seg" aria-label="Track">
      <Link href="/neurips" aria-current={!track ? "page" : undefined}>By session</Link>
      {(Object.keys(TRACKS) as Track[]).map((t) => (
        <Link key={t} href={`/neurips?track=${t}`} aria-current={track === t ? "page" : undefined}>
          {TRACKS[t].label}
        </Link>
      ))}
    </nav>
  );
}

async function List({ papers }: { papers: Score[] }) {
  const verdicts = await getVerdicts(papers.map((p) => p.id));
  return (
    <section aria-label="Papers" className="all-papers">
      {papers.map((s, i) => (
        <div key={s.id} id={`p${i}`} className="card-anchor">
          <PaperCard paper={s} score={s} verdicts={verdicts.get(s.id) ?? []} />
        </div>
      ))}
    </section>
  );
}

export default async function NeuripsPage({ searchParams }: Props) {
  const { track: t, session, n } = await searchParams;
  const track = t && t in TRACKS ? (t as Track) : null;
  const shown = Math.min(2000, Math.max(PAGE, Number(n) || PAGE));

  if (session) {
    const s = await sessionPapers(session);
    return (
      <main className="wrap page">
        <p className="crumb"><Link href="/neurips">{NEURIPS}</Link></p>
        <h1 className="page-title">{session}</h1>
        <p className="page-sub">
          {[sessionWhen(session, s.start, s.end), s.room].filter(Boolean).join(" · ")} · {s.papers.length} papers, best rated first
        </p>
        <List papers={s.papers} />
      </main>
    );
  }

  if (track) {
    const papers = await trackPapers(track, shown + 1);
    return (
      <main className="wrap page">
        <div className="section-head">
          <h1 className="page-title">{NEURIPS} {TRACKS[track].label.toLowerCase()}</h1>
          <Tabs track={track} />
        </div>
        <p className="page-sub">Best rated first.</p>
        <List papers={papers.slice(0, shown)} />
        {papers.length > shown && (
          <Link href={`/neurips?track=${track}&n=${shown + PAGE}#p${shown}`} className="load-more">
            Show {PAGE} more papers
          </Link>
        )}
      </main>
    );
  }

  const { sessions, total } = await bestBySession(6);
  return (
    <main className="wrap page">
      <div className="section-head">
        <h1 className="page-title">{NEURIPS}</h1>
        <Tabs track={null} />
      </div>
      <p className="page-sub">
        The best-rated papers in every poster session{total ? `, from ${total.toLocaleString("en-US")} presentations` : ""}. Plan your walk
        through the halls.
      </p>
      {sessions.length === 0 && <p className="empty">The NeurIPS 2026 papers are on their way.</p>}
      {sessions.map((s) => (
        <section key={s.name} className="shelf" aria-label={s.name}>
          <div className="shelf-head">
            <div>
              <h2>{s.name}</h2>
              <p className="shelf-note">{[sessionWhen(s.name, s.start, s.end), s.room].filter(Boolean).join(" · ")}</p>
            </div>
            <Link href={`/neurips?session=${encodeURIComponent(s.name)}`} className="shelf-more">See all</Link>
          </div>
          <div className="shelf-row">
            {s.papers.map((p) => (
              <MiniCard key={p.id} s={p} />
            ))}
          </div>
        </section>
      ))}
    </main>
  );
}
