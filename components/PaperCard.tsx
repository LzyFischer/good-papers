import Link from "next/link";
import { AREAS } from "@/lib/areas";
import { arxivIdOf } from "@/lib/arxiv";
import { sessionWhen } from "@/lib/sessions";
import { isPreprint, orgKind, shortOrg, venueLabel } from "@/lib/orgs";
import { PERSONAS, PERSONA_IDS, TIERS } from "@/lib/personas";
import type { AiVerdict, Paper, Score } from "@/lib/types";
import { Gate } from "./Gate";
import { Icon, type IconName } from "./Icons";
import { Gauge, tierOf } from "./Score";
import { VoteButtons } from "./VoteButtons";

export function formatAuthors(authors: string[], max = 4) {
  if (authors.length === 0) return "Unknown authors";
  if (authors.length <= max) return authors.join(", ");
  return `${authors.slice(0, max).join(", ")} and ${authors.length - max} more`;
}

// "Sep 28, 2026"; OpenAlex stores year-only dates as Jan 1, so show just the year then.
export function formatPublished(date: string | null | undefined, year: number | null) {
  if (!date) return year ? String(year) : null;
  if (date.endsWith("-01-01")) return date.slice(0, 4);
  return new Date(`${date}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

// Each author links to all their papers on the site.
export function AuthorLinks({ authors, max, paperId }: { authors: string[]; max: number; paperId: string }) {
  if (authors.length === 0) return <>Unknown authors</>;
  const shown = authors.slice(0, max);
  return (
    <>
      {shown.map((a, i) => (
        <span key={`${a}-${i}`}>
          {i > 0 && ", "}
          <Link href={`/author/${encodeURIComponent(a)}${/^W\d+$/.test(paperId) ? `?from=${paperId}` : ""}`}>{a}</Link>
        </span>
      ))}
      {authors.length > max && ` and ${authors.length - max} more`}
    </>
  );
}

// The AI panel as dots grouped by tier; hover a dot for what that reviewer checks.
export function AiDots({ ordered }: { ordered: AiVerdict[] }) {
  return (
    <div className="dots-wrap">
      {TIERS.map((tier) => {
        const group = ordered.filter((x) => PERSONAS[x.persona]?.tier === tier);
        if (group.length === 0) return null;
        return (
          <div key={tier} className="dots-row">
            <span className="dots-label">
              {tier} <b>{group.filter((x) => x.fresh).length}/{group.length}</b>
            </span>
            <span className="dots" role="list">
              {group.map((x) => (
                <span
                  key={x.persona}
                  role="listitem"
                  className={`dot ${x.fresh ? "dot--up" : "dot--down"}`}
                  title={`${PERSONAS[x.persona].focus}: ${Math.round(x.probability * 100)}% worth reading`}
                />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function Table({ icon, label, fresh, total, note, ai, open }: {
  icon: IconName; label: string; fresh: number; total: number; note?: string; ai?: boolean; open?: boolean;
}) {
  // The AI panel shows a count, not a percentage: "3 of 20" reads fairer than "15%".
  // Readers' split is revealed on the paper page after you vote (open: the Trending teaser).
  const pct = !total ? "–" : ai ? `${fresh}/${total}` : open ? `${Math.round((fresh / total) * 100)}%` : String(total);
  return (
    <div className={ai ? "tbl tbl--ai" : "tbl"}>
      <Icon name={icon} />
      <span className="n">
        {pct} <span className="l">{label}</span>
      </span>
      <span className="l">
        {total ? (ai ? "reviewers recommend it" : open ? `${fresh} of ${total} upvoted` : "voted. Vote to see how they split") : "No votes yet"}
        {note ? `. ${note}` : ""}
      </span>
    </div>
  );
}

type Props = {
  paper: Pick<Paper, "id" | "title" | "authors" | "year" | "venue" | "url" | "orgs" | "tags"> &
    Partial<Pick<Paper, "publishedOn" | "citedByCount">>;
  score: Score | null;
  verdicts: AiVerdict[];
  linkTitle?: boolean; // link the title to our paper page (lists) or to the source (paper page)
  openPanel?: boolean;
  scoreOpen?: boolean; // show how readers split without voting (the Trending teaser)
};

export function PaperCard({ paper, score, verdicts, linkTitle = true, openPanel = false, scoreOpen = false }: Props) {
  const v = tierOf(score);
  const area = score?.area && AREAS[score.area] ? { key: score.area, label: AREAS[score.area].label } : null;
  const ordered = PERSONA_IDS.map((id) => verdicts.find((x) => x.persona === id)).filter(Boolean) as AiVerdict[];
  const published = formatPublished(paper.publishedOn ?? score?.published_on, paper.year);
  const citations = paper.citedByCount ?? score?.cited_by_count ?? null;
  const arxivId = arxivIdOf(paper.url);

  const title = linkTitle ? (
    <Link href={`/paper/${paper.id}`}>{paper.title}</Link>
  ) : paper.url ? (
    <a href={paper.url} target="_blank" rel="noopener noreferrer">
      {paper.title}
    </a>
  ) : (
    paper.title
  );

  return (
    <article className="card">
      <Gate
        id={paper.id}
        open={scoreOpen || !v}
        mask={
          <div className="score pending">
            <span className="gauge gauge--lg gauge--empty"><b>?</b></span>
            <span className="word">Vote to see</span>
          </div>
        }
      >
        <div className={`score ${v ? `tone-${v.tone}` : "pending"}`}>
          {v ? <Gauge pct={v.pct} tone={v.tone} /> : <span className="gauge gauge--lg gauge--empty"><b>?</b></span>}
          <span className="word">{v ? v.label : "Not rated yet"}</span>
        </div>
      </Gate>

      <div className="card-body">
        <div className="meta">
          {paper.venue && <span className={`tag venue ${isPreprint(paper.venue) ? "venue--preprint" : ""}`}>{venueLabel(paper.venue, paper.year)}</span>}
          {paper.tags.map((t) => (
            <span key={t} className={`tag ${t === "Oral" ? "oral" : ""}`}>
              {t}
            </span>
          ))}
          {paper.orgs.slice(0, 5).map((o) => {
            const kind = orgKind(o);
            return (
              <Link key={o} href={`/?org=${encodeURIComponent(o)}`} className={`tag ${kind ? `org-${kind}` : ""}`} title={`All papers from ${o}`}>
                {shortOrg(o)}
              </Link>
            );
          })}
          {area && (
            <Link href={`/?area=${area.key}`} className="tag tag--area">
              {area.label}
            </Link>
          )}
        </div>
        {score?.thumbnail && (
          // Hotlinked arXiv figure; plain img keeps it out of Next's image proxy.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="thumb" src={score.thumbnail} alt="" loading="lazy" />
        )}
        <h2 className="title">{title}</h2>
        {score?.tldr && <p className="tldr">{score.tldr}</p>}
        <p className="authors">
          <AuthorLinks authors={paper.authors} max={linkTitle ? 4 : 60} paperId={paper.id} />
        </p>
        {(published || citations !== null || score?.hf_upvotes || score?.github_url || score?.conf_sessions?.length) && (
          <p className="pubinfo">
            {[
              ...(score?.conf_sessions ?? []).map((ses) => (
                <Link key={ses.name} href={`/neurips?session=${encodeURIComponent(ses.name)}`}>
                  {ses.name}, {sessionWhen(ses.name, ses.start, ses.end).replace(" local time", "")}
                  {ses.room ? `, ${ses.room}` : ""}
                </Link>
              )),
              published && <span key="p">Published {published}</span>,
              citations !== null && <span key="c">{`${citations.toLocaleString("en-US")} citation${citations === 1 ? "" : "s"}`}</span>,
              score?.hf_upvotes && arxivId ? (
                <a key="hf" href={`https://huggingface.co/papers/${arxivId}`} target="_blank" rel="noopener noreferrer">
                  ▲ {score.hf_upvotes} on Hugging Face
                </a>
              ) : null,
              score?.github_url ? (
                <a key="gh" href={score.github_url} target="_blank" rel="noopener noreferrer">
                  Code{score.github_stars ? ` ★ ${score.github_stars.toLocaleString("en-US")}` : ""}
                </a>
              ) : null,
            ]
              .filter(Boolean)
              .flatMap((x, i) => (i ? [" · ", x] : [x]))}
          </p>
        )}
        {!linkTitle && score?.panel_consensus && (
          <p className="consensus">
            <b>Panel consensus</b>
            {score.panel_consensus}
          </p>
        )}

        <Gate id={paper.id} open={scoreOpen || !v} mask={<p className="gate-hint">Readers and the AI panel: vote on this paper to see what they said.</p>}>
        <div className="tables">
          <Table
            icon="readers"
            label="Readers"
            fresh={score?.reader_fresh ?? 0}
            total={score?.reader_total ?? 0}
            open
            note={[
              score?.consensus ? "Cross-camp consensus" : null,
              score?.reader_coi ? `${score.reader_coi} from authors or colleagues not counted` : null,
            ].filter(Boolean).join(". ") || undefined}
          />
          <Table icon="ai" label="AI panel" fresh={score?.ai_fresh ?? 0} total={score?.ai_total ?? 0} ai />
        </div>
        </Gate>

        <VoteButtons
          paper={{ id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, url: paper.url }}
        />

        {ordered.length > 0 && (
          <Gate id={paper.id} open={scoreOpen} mask={null}>
            <details className="panel" open={openPanel}>
              <summary>
                AI panel: {ordered.filter((x) => x.fresh).length} of {ordered.length} reviewers recommend it
              </summary>
              <AiDots ordered={ordered} />
            </details>
          </Gate>
        )}
      </div>
    </article>
  );
}
