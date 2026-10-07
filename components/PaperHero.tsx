import Link from "next/link";
import { AREAS } from "@/lib/areas";
import { arxivIdOf } from "@/lib/arxiv";
import { sessionWhen } from "@/lib/sessions";
import { isPreprint, orgKind, shortOrg, venueLabel } from "@/lib/orgs";
import { PERSONA_IDS } from "@/lib/personas";
import type { AiVerdict, Paper, Score } from "@/lib/types";
import { AiDots, AuthorLinks, formatPublished } from "./PaperCard";
import { Gauge, tierOf } from "./Score";
import { ShareButton } from "./ShareButton";
import { VoteButtons } from "./VoteButtons";

// The top of a paper page: header, scorecard (overall, readers, AI panel) and the panel consensus.
export function PaperHero({ paper, score, verdicts, splitOpen = false }: { paper: Paper; score: Score | null; verdicts: AiVerdict[]; splitOpen?: boolean }) {
  const t = tierOf(score);
  const area = score?.area && AREAS[score.area] ? { key: score.area, label: AREAS[score.area].label } : null;
  const ordered = PERSONA_IDS.map((id) => verdicts.find((x) => x.persona === id)).filter(Boolean) as AiVerdict[];
  const aiYes = ordered.filter((x) => x.fresh).length;
  const arxivId = arxivIdOf(paper.url);
  const published = formatPublished(paper.publishedOn ?? score?.published_on, paper.year);
  const citations = paper.citedByCount ?? score?.cited_by_count ?? null;
  const readers = score?.reader_total ?? 0;

  const facts = [
    published && `Published ${published}`,
    citations ? `${citations.toLocaleString("en-US")} citation${citations === 1 ? "" : "s"}` : null, // 0 just means "new"
    ...(score?.conf_sessions ?? []).map((ses) => [ses.name, sessionWhen(ses.name, ses.start, ses.end), ses.room].filter(Boolean).join(" · ")),
  ].filter(Boolean) as string[];

  return (
    <header className="ph">
      <div className="ph-top">
        <div className="ph-main">
          <div className="ph-tags">
            {!isPreprint(paper.venue) && <span className="tag venue">{venueLabel(paper.venue, paper.year)}</span>}
            {area && <Link href={`/?area=${area.key}`} className="tag tag--area">{area.label}</Link>}
            {paper.tags.map((x) => <span key={x} className={`tag ${x === "Oral" ? "oral" : ""}`}>{x}</span>)}
            {paper.orgs.slice(0, 6).map((o) => (
              <Link key={o} href={`/?org=${encodeURIComponent(o)}`} className={`tag ${orgKind(o) ? `org-${orgKind(o)}` : ""}`} title={o}>
                {shortOrg(o)}
              </Link>
            ))}
          </div>
          <h1 className="ph-title">{paper.title}</h1>
          {score?.tldr && <p className="ph-tldr">{score.tldr}</p>}
          <p className="ph-authors">
            <AuthorLinks authors={paper.authors} max={40} paperId={paper.id} />
          </p>
          <p className="ph-facts">
            {facts.map((f) => <span key={f}>{f}</span>)}
            {score?.hf_upvotes && arxivId ? (
              <a href={`https://huggingface.co/papers/${arxivId}`} target="_blank" rel="noopener noreferrer">▲ {score.hf_upvotes} on Hugging Face</a>
            ) : null}
            {score?.github_url ? (
              <a href={score.github_url} target="_blank" rel="noopener noreferrer">
                Code{score.github_stars ? ` ★ ${score.github_stars.toLocaleString("en-US")}` : ""}
              </a>
            ) : null}
            {paper.url && <a href={paper.url} target="_blank" rel="noopener noreferrer">{arxivId ? "arXiv" : /openreview/.test(paper.url) ? "OpenReview" : "Paper"} ↗</a>}
            <ShareButton id={paper.id} title={paper.title} pct={t ? t.pct : null} />
          </p>
        </div>
        {score?.thumbnail && (
          // Hotlinked arXiv figure; plain img keeps it out of Next's image proxy.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="ph-img" src={score.thumbnail} alt="" />
        )}
      </div>

      <div className="scorecard">
        <div className={`sc sc--main ${t ? `tone-${t.tone}` : ""}`}>
          {t ? <Gauge pct={t.pct} tone={t.tone} /> : <span className="gauge gauge--lg gauge--empty"><b>?</b></span>}
          <div>
            <span className="sc-label">Overall</span>
            <span className="sc-tier">{t ? t.label : "Not rated yet"}</span>
            {t && !score?.ai_total && !score?.reader_total && score?.conf_track && (
              <span className="sc-note">Starting score from its {score.venue} track. The AI panel reads it once the abstract is public.</span>
            )}
          </div>
        </div>
        <div className="sc">
          <span className="sc-label">Readers</span>
          <VoteButtons
            paper={{ id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, url: paper.url }}
            reveal={{ readerFresh: score?.reader_fresh ?? 0, readerTotal: readers, aiYes, aiTotal: ordered.length, coi: score?.reader_coi ?? 0, open: splitOpen }}
          />
        </div>
        <div className="sc sc--ai">
          <span className="sc-label">AI panel</span>
          <span className="sc-num">{ordered.length ? `${aiYes}/${ordered.length}` : "–"}</span>
          <span className="sc-sub">reviewers recommend it</span>
          {ordered.length > 0 && <AiDots ordered={ordered} />}
        </div>
      </div>

      {score?.panel_consensus && (
        <figure className="ph-consensus">
          <figcaption>Panel consensus</figcaption>
          <blockquote>{score.panel_consensus}</blockquote>
        </figure>
      )}
    </header>
  );
}
