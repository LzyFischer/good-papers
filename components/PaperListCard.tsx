// A paper in a list (All papers, shelf pages, NeurIPS sessions): the score in a column on the
// left; an eyebrow line, title, TL;DR and authors, then a few numbers and the vote buttons;
// the figure sits on the right. The paper page shows the full breakdown (PaperHero).
import Link from "next/link";
import { AREAS } from "@/lib/areas";
import { arxivIdOf } from "@/lib/arxiv";
import { tex } from "@/lib/latex";
import { venueLabel } from "@/lib/orgs";
import type { Score } from "@/lib/types";
import { Gate } from "./Gate";
import { LiveGauge, LiveLabel } from "./LiveScore";
import { AuthorLinks, formatPublished } from "./PaperCard";
import { tierOf } from "./Score";
import { Thumb } from "./Thumb";
import { VoteButtons } from "./VoteButtons";

export function PaperListCard({ s, scoreOpen = false }: { s: Score; scoreOpen?: boolean }) {
  const t = tierOf(s);
  const area = s.area && AREAS[s.area] ? { key: s.area, label: AREAS[s.area].label } : null;
  const published = formatPublished(s.published_on, s.year);
  const arxivId = arxivIdOf(s.url);
  const track = s.conf_track && s.conf_track !== "poster" ? (s.conf_track === "oral" ? "Oral" : "Spotlight") : null;
  const stats = [
    s.hf_upvotes && arxivId ? (
      <a key="hf" href={`https://huggingface.co/papers/${arxivId}`} target="_blank" rel="noopener noreferrer">▲ {s.hf_upvotes} HF</a>
    ) : null,
    s.cited_by_count ? <span key="c">{`${s.cited_by_count.toLocaleString("en-US")} citation${s.cited_by_count === 1 ? "" : "s"}`}</span> : null,
    s.github_url ? (
      <a key="gh" href={s.github_url} target="_blank" rel="noopener noreferrer">Code{s.github_stars ? ` ★ ${s.github_stars.toLocaleString("en-US")}` : ""}</a>
    ) : null,
    s.comments ? <span key="d">{`${s.comments} comment${s.comments === 1 ? "" : "s"}`}</span> : null,
  ].filter(Boolean);

  return (
    <article className="lcard">
      <div className="lcard-side">
        <Gate
          id={s.id}
          open={scoreOpen || !t}
          mask={
            <span className={`lcard-score tone-${t?.tone ?? 1}`} title="Vote to see the score">
              <span className="gauge gauge--lg gauge--empty"><b>?</b></span>
              <span className="lcard-tier">{t?.label}</span>
            </span>
          }
        >
          <span className={`lcard-score tone-${t?.tone ?? 1}`}>
            {t ? <LiveGauge id={s.id} score={s.score!} /> : <span className="gauge gauge--lg gauge--empty"><b>?</b></span>}
            <span className="lcard-tier">{t ? <LiveLabel id={s.id} score={s.score!} /> : "Not rated yet"}</span>
          </span>
        </Gate>
      </div>
      <div className="lcard-main">
        <p className="lcard-eyebrow">
          {[
            s.venue ? <span key="v">{venueLabel(s.venue, s.year)}</span> : null,
            track ? <span key="t" className="lcard-track">{track}</span> : null,
            area ? <Link key="a" href={`/?area=${area.key}`} className="lcard-area">{area.label}</Link> : null,
            published ? <span key="p">{published}</span> : null,
          ]
            .filter(Boolean)
            .flatMap((x, i) => (i ? [<span key={`s${i}`} aria-hidden="true"> · </span>, x] : [x]))}
        </p>
        <h2 className="lcard-title">
          <Link href={`/paper/${s.id}`}>{tex(s.title)}</Link>
        </h2>
        {s.tldr && <p className="lcard-tldr">{s.tldr}</p>}
        <p className="lcard-authors">
          <AuthorLinks authors={s.authors} max={4} paperId={s.id} />
        </p>
        <div className="lcard-foot">
          {stats.length > 0 && <span className="lcard-stats">{stats.flatMap((x, i) => (i ? [" · ", x] : [x]))}</span>}
          <span className="lcard-vote">
            <VoteButtons paper={{ id: s.id, title: s.title, authors: s.authors ?? [], year: s.year, venue: s.venue, url: s.url }} compact />
          </span>
        </div>
      </div>
      {s.thumbnail && (
        <Link href={`/paper/${s.id}`} className="lcard-fig" tabIndex={-1} aria-hidden="true">
          <Thumb src={s.thumbnail} />
        </Link>
      )}
    </article>
  );
}
