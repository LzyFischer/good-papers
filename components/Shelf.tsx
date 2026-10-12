import Link from "next/link";
import { AREAS } from "@/lib/areas";
import { isPreprint, venueLabel } from "@/lib/orgs";
import type { Score } from "@/lib/types";
import { Gate } from "./Gate";
import { Thumb } from "./Thumb";
import { LiveGauge, LiveLabel } from "./LiveScore";
import { VoteButtons } from "./VoteButtons";
import { tierOf } from "./Score";

// Compact card for horizontal shelves: thumbnail, score, title, TL;DR.
export function MiniCard({ s, scoreOpen = false, why }: { s: Score; scoreOpen?: boolean; why?: string }) {
  const t = tierOf(s);
  const area = s.area ? AREAS[s.area]?.label : null;
  return (
    <div className="mini">
      <Link href={`/paper/${s.id}`} className="mini-link">
        <span className="mini-thumb">
          {s.thumbnail ? (
            <Thumb src={s.thumbnail} fallback={<span className="mini-thumb-empty">{area ?? "Paper"}</span>} />
          ) : (
            <span className="mini-thumb-empty">{area ?? "Paper"}</span>
          )}
          {t && (
            <span className="mini-score">
              <Gate id={s.id} open={scoreOpen} mask={<span className="gauge gauge--sm gauge--empty"><b>?</b></span>}>
                <LiveGauge id={s.id} score={s.score!} size="sm" />
              </Gate>
            </span>
          )}
        </span>
        {why && <span className="mini-why">{why}</span>}
        <span className="mini-title">{s.title}</span>
        {s.tldr && <span className="mini-tldr">{s.tldr}</span>}
        <span className="mini-meta">
          {!isPreprint(s.venue) && (
            <span className="mini-venue">
              {venueLabel(s.venue, s.year)}
              {s.conf_track && s.conf_track !== "poster" ? ` ${s.conf_track === "oral" ? "Oral" : "Spotlight"}` : ""}
            </span>
          )}
          {t && <LiveLabel id={s.id} score={s.score!} />}
          <Gate id={s.id} open={scoreOpen || !t} mask={<span className="vote-to-see"> · vote to see score</span>}>
            {""}
          </Gate>
          {s.hf_upvotes ? ` · ▲ ${s.hf_upvotes} on HF` : ""}
          {s.comments ? ` · ${s.comments} comments` : ""}
        </span>
      </Link>
      <VoteButtons paper={{ id: s.id, title: s.title, authors: s.authors ?? [], year: s.year, venue: s.venue, url: s.url }} compact />
    </div>
  );
}

export function Shelf({ id, title, note, papers, children, more, openIds, reasons }: {
  id?: string; title: string; note?: string; papers: Score[]; children?: React.ReactNode; more?: { href: string; label: string };
  openIds?: string[]; // papers whose score shows without voting (top of Trending)
  reasons?: Record<string, string>; // For you: why each paper is here
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
            <MiniCard key={s.id} s={s} scoreOpen={i < Math.ceil(papers.length / 2) || openIds?.includes(s.id)} why={reasons?.[s.id]} />
          ))}
        </div>
      )}
    </section>
  );
}
