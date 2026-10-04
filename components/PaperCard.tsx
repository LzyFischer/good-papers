import Link from "next/link";
import { AREAS, PAPER_TYPES } from "@/lib/areas";
import { orgKind, shortOrg } from "@/lib/orgs";
import { PERSONAS, PERSONA_IDS, TIERS, spokespersons } from "@/lib/personas";
import type { AiVerdict, Paper, Score } from "@/lib/types";
import { Icon, type IconName } from "./Icons";
import { basisOf, verdictOf } from "./Score";
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

function Table({ icon, label, fresh, total, note, ai }: {
  icon: IconName; label: string; fresh: number; total: number; note?: string; ai?: boolean;
}) {
  const pct = total ? `${Math.round((fresh / total) * 100)}%` : "–";
  return (
    <div className={ai ? "tbl tbl--ai" : "tbl"}>
      <Icon name={icon} />
      <span className="n">
        {pct} <span className="l">{label}</span>
      </span>
      <span className="l">
        {total ? `${fresh}/${total} fresh` : "No votes yet"}
        {note ? `, ${note}` : ""}
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
};

export function PaperCard({ paper, score, verdicts, linkTitle = true, openPanel = false }: Props) {
  const v = verdictOf(score);
  const area = score?.area && AREAS[score.area] ? { key: score.area, label: AREAS[score.area].label } : null;
  const type = score?.paper_type ? PAPER_TYPES[score.paper_type]?.label : null;
  const ordered = PERSONA_IDS.map((id) => verdicts.find((x) => x.persona === id)).filter(Boolean) as AiVerdict[];
  const takes = spokespersons(ordered);
  const published = formatPublished(paper.publishedOn ?? score?.published_on, paper.year);
  const citations = paper.citedByCount ?? score?.cited_by_count ?? null;

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
      <div className={`score ${v ? (v.fresh ? "fresh" : "rotten") : "pending"}`}>
        <Icon name={v ? (v.fresh ? "fresh" : "rotten") : "pending"} />
        <b>{v ? `${v.pct}%` : "?"}</b>
        <span className="word">{v ? (v.fresh ? "Fresh" : "Rotten") : "Not judged"}</span>
        {v && score && <small>{basisOf(score)}</small>}
      </div>

      <div className="card-body">
        <div className="meta">
          {paper.venue && <span className="tag venue">{paper.venue}{paper.year ? ` ${paper.year}` : ""}</span>}
          {paper.tags.map((t) => (
            <span key={t} className={`tag ${t === "Oral" ? "oral" : ""}`}>
              {t}
            </span>
          ))}
          {paper.orgs.slice(0, 5).map((o) => {
            const kind = orgKind(o);
            return (
              <span key={o} className={`tag ${kind ? `org-${kind}` : ""}`} title={o}>
                {shortOrg(o)}
              </span>
            );
          })}
          {area && (
            <Link href={`/?area=${area.key}`} className="tag tag--area">
              {area.label}
            </Link>
          )}
          {type && <span className="tag">{type}</span>}
        </div>
        <h2 className="title">{title}</h2>
        <p className="authors">{formatAuthors(paper.authors)}</p>
        {(published || citations !== null) && (
          <p className="pubinfo">
            {published && <>Published {published}</>}
            {published && citations !== null && " · "}
            {citations !== null && `${citations.toLocaleString("en-US")} citation${citations === 1 ? "" : "s"}`}
          </p>
        )}

        <div className="tables">
          <Table icon="readers" label="Readers" fresh={score?.reader_fresh ?? 0} total={score?.reader_total ?? 0} />
          <Table icon="ai" label="AI panel" fresh={score?.ai_fresh ?? 0} total={score?.ai_total ?? 0} ai />
        </div>

        <VoteButtons
          paper={{ id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, url: paper.url }}
        />

        {ordered.length > 0 && (
          <details className="panel" open={openPanel}>
            <summary>
              AI panel: {ordered.filter((x) => x.fresh).length} of {ordered.length} reviewers say fresh
            </summary>
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
                          className={`dot ${x.fresh ? "dot--fresh" : "dot--rotten"}`}
                          title={`${PERSONAS[x.persona].name} (${PERSONAS[x.persona].focus}): ${Math.round(x.probability * 100)}% worth reading`}
                        />
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
            {takes.length > 0 && (
              <ul className="takes">
                {takes.map((x) => (
                  <li key={x.persona} className="take">
                    <Icon name={x.fresh ? "fresh" : "rotten"} />
                    <p>
                      <span className="who">
                        {x.fresh ? "Strongest case for" : "Strongest case against"}{" "}
                        <em>({PERSONAS[x.persona].name})</em>
                      </span>
                      <br />
                      {x.take ?? `${Math.round(x.probability * 100)}% likely to call it worth reading.`}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </details>
        )}
      </div>
    </article>
  );
}
