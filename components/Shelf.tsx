import Link from "next/link";
import { AREAS } from "@/lib/areas";
import type { Score } from "@/lib/types";
import { Gauge, tierOf } from "./Score";

// Compact card for horizontal shelves: thumbnail, score, title, TL;DR.
export function MiniCard({ s }: { s: Score }) {
  const t = tierOf(s);
  const area = s.area ? AREAS[s.area]?.label : null;
  return (
    <Link href={`/paper/${s.id}`} className="mini">
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
            <Gauge pct={t.pct} tone={t.tone} size="sm" />
          </span>
        )}
      </span>
      <span className="mini-title">{s.title}</span>
      {s.tldr && <span className="mini-tldr">{s.tldr}</span>}
      <span className="mini-meta">
        {t?.label}
        {s.hf_upvotes ? ` · ▲ ${s.hf_upvotes} on HF` : ""}
        {s.comments ? ` · ${s.comments} comments` : ""}
      </span>
    </Link>
  );
}

export function Shelf({ title, papers, children, more }: {
  title: string; papers: Score[]; children?: React.ReactNode; more?: { href: string; label: string };
}) {
  if (papers.length === 0 && !children) return null;
  return (
    <section className="shelf" aria-label={title}>
      <div className="shelf-head">
        <h2>{title}</h2>
        {children}
        {more && <Link href={more.href} className="shelf-more">{more.label}</Link>}
      </div>
      {papers.length === 0 ? (
        <p className="hint">Nothing here yet.</p>
      ) : (
        <div className="shelf-row">
          {papers.map((s) => (
            <MiniCard key={s.id} s={s} />
          ))}
        </div>
      )}
    </section>
  );
}
