import Link from "next/link";
import { AREAS } from "@/lib/areas";
import { isPreprint, venueLabel } from "@/lib/orgs";
import type { Score } from "@/lib/types";
import { Gate } from "./Gate";
import { VoteButtons } from "./VoteButtons";
import { Gauge, tierOf } from "./Score";

// Compact card for horizontal shelves: thumbnail, score, title, TL;DR.
export function MiniCard({ s, scoreOpen = false }: { s: Score; scoreOpen?: boolean }) {
  const t = tierOf(s);
  const area = s.area ? AREAS[s.area]?.label : null;
  return (
    <div className="mini">
      <Link href={`/paper/${s.id}`} className="mini-link">
        <span className="mini-thumb">
          {s.thumbnail ? (
            // Figures are hotlinked from arXiv; plain img keeps them out of Next's image proxy.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={s.thumbnail} alt="" loading="lazy" />
          ) : (
            <span className="mini-thumb-empty">{area ?? "Paper"}</span>
          )}
          {t && (
            <span className="mini-score">
              <Gate id={s.id} open={scoreOpen} mask={<span className="gauge gauge--sm gauge--empty"><b>?</b></span>}>
                <Gauge pct={t.pct} tone={t.tone} size="sm" />
              </Gate>
            </span>
          )}
        </span>
        <span className="mini-title">{s.title}</span>
        {s.tldr && <span className="mini-tldr">{s.tldr}</span>}
        <span className="mini-meta">
          {!isPreprint(s.venue) && (
            <span className="mini-venue">
              {venueLabel(s.venue, s.year)}
              {s.conf_track && s.conf_track !== "poster" ? ` ${s.conf_track === "oral" ? "Oral" : "Spotlight"}` : ""}
            </span>
          )}
          {t?.label}
          <Gate id={s.id} open={scoreOpen || !t} mask={<span className="vote-to-see"> · vote to see score</span>}>
            {s.reader_total ? ` · ${Math.round((s.reader_fresh / s.reader_total) * 100)}% of ${s.reader_total} readers upvoted` : ""}
          </Gate>
          {s.hf_upvotes ? ` · ▲ ${s.hf_upvotes} on HF` : ""}
          {s.comments ? ` · ${s.comments} comments` : ""}
        </span>
      </Link>
      <VoteButtons paper={{ id: s.id, title: s.title, authors: s.authors ?? [], year: s.year, venue: s.venue, url: s.url }} compact />
    </div>
  );
}

export function Shelf({ id, title, note, papers, children, more, openIds }: {
  id?: string; title: string; note?: string; papers: Score[]; children?: React.ReactNode; more?: { href: string; label: string };
  openIds?: string[]; // papers whose score shows without voting (top of Trending)
}) {
  if (papers.length === 0 && !children) return null;
  return (
    <section className="shelf" aria-label={title} id={id}>
      <div className="shelf-head">
        <div>
          <h2>{title}</h2>
          {note && <p className="shelf-note">{note}</p>}
        </div>
        {children}
        {more && <Link href={more.href} className="shelf-more">{more.label}</Link>}
      </div>
      {papers.length === 0 ? (
        <p className="hint">Nothing here yet.</p>
      ) : (
        <div className="shelf-row">
          {papers.map((s, i) => (
            // The first half of every shelf shows its scores; the rest after you vote.
            <MiniCard key={s.id} s={s} scoreOpen={i < Math.ceil(papers.length / 2) || openIds?.includes(s.id)} />
          ))}
        </div>
      )}
    </section>
  );
}
