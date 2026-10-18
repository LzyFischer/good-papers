// The side card next to the abstract and discussion on a paper page: where to read the paper
// and its code, kept in view while the reader scrolls. The score and votes live in the
// scorecard above, so they aren't repeated here.
import { arxivIdOf } from "@/lib/arxiv";
import type { Paper, Score } from "@/lib/types";
import { formatPublished } from "./PaperCard";

export function PaperAside({ paper, score }: { paper: Paper; score: Score | null }) {
  const arxivId = arxivIdOf(paper.url);
  const published = formatPublished(paper.publishedOn ?? score?.published_on, paper.year);
  const pdf = arxivId ? `https://arxiv.org/pdf/${arxivId}` : paper.url;
  const comments = score?.comments ?? 0;

  return (
    <aside className="paside" aria-label="Links">
      <div className="paside-card">
        <span className="paside-label">Links</span>
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
      </div>
    </aside>
  );
}
