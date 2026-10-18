// The side card next to the abstract and discussion on a paper page: the score, the links
// and the vote buttons, kept in view while the reader scrolls (sticky on wide screens).
import { arxivIdOf } from "@/lib/arxiv";
import type { Paper, Score } from "@/lib/types";
import { Gate } from "./Gate";
import { LiveGauge, LiveLabel } from "./LiveScore";
import { formatPublished } from "./PaperCard";
import { tierOf } from "./Score";
import { VoteButtons } from "./VoteButtons";

export function PaperAside({ paper, score, scoreOpen = false }: { paper: Paper; score: Score | null; scoreOpen?: boolean }) {
  const t = tierOf(score);
  const arxivId = arxivIdOf(paper.url);
  const published = formatPublished(paper.publishedOn ?? score?.published_on, paper.year);
  const pdf = arxivId ? `https://arxiv.org/pdf/${arxivId}` : paper.url;
  const comments = score?.comments ?? 0;

  return (
    <aside className="paside" aria-label="At a glance">
      <div className="paside-card">
        <span className="paside-label">At a glance</span>
        <Gate
          id={paper.id}
          open={scoreOpen || !t}
          mask={
            <span className={`paside-score tone-${t?.tone ?? 1}`} title="Vote to see the score">
              <span className="gauge gauge--sm gauge--empty"><b>?</b></span>
              <span>{t?.label}<small>Vote to see the score</small></span>
            </span>
          }
        >
          <span className={`paside-score tone-${t?.tone ?? 1}`}>
            {t ? <LiveGauge id={paper.id} score={score!.score!} size="sm" /> : <span className="gauge gauge--sm gauge--empty"><b>?</b></span>}
            <span>{t ? <LiveLabel id={paper.id} score={score!.score!} /> : "Not rated yet"}</span>
          </span>
        </Gate>
        <ul className="paside-links">
          {pdf && (
            <li>
              <a href={pdf} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">↗</span>{arxivId ? "Read the PDF" : "Open the paper"}</a>
            </li>
          )}
          {score?.github_url && (
            <li>
              <a href={score.github_url} target="_blank" rel="noopener noreferrer">
                <span aria-hidden="true">{"</>"}</span>Code{score.github_stars ? ` · ★ ${score.github_stars.toLocaleString("en-US")}` : ""}
              </a>
            </li>
          )}
          {score?.hf_upvotes && arxivId ? (
            <li>
              <a href={`https://huggingface.co/papers/${arxivId}`} target="_blank" rel="noopener noreferrer"><span aria-hidden="true">▲</span>{score.hf_upvotes} on Hugging Face</a>
            </li>
          ) : null}
          <li>
            <a href="#discussion"><span aria-hidden="true">#</span>{comments ? `${comments} comment${comments === 1 ? "" : "s"}` : "Discussion"}</a>
          </li>
          {published && <li className="paside-date"><span aria-hidden="true">·</span>{published}</li>}
        </ul>
        <VoteButtons paper={{ id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, url: paper.url }} compact />
      </div>
    </aside>
  );
}
