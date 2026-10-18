import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Comments } from "@/components/Comments";
import { NoteBox } from "@/components/NoteBox";
import { ReadTracker } from "@/components/ReadTracker";
import { WarmUp } from "@/components/WarmUp";
import { PaperHero } from "@/components/PaperHero";
import { tierOf } from "@/components/Score";
import { arxivIdOf } from "@/lib/arxiv";
import { getPaperAnywhere, getScores, getVerdicts, storedIdsByArxiv } from "@/lib/papers";
import { openScoreIds } from "@/lib/trending";
import { SITE_URL } from "@/lib/site";
import type { Score } from "@/lib/types";
import { tex } from "@/lib/latex";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const [paper, scores] = await Promise.all([getPaperAnywhere(id).catch(() => null), getScores([id]).catch(() => new Map())]);
  if (!paper) return { title: "Paper" };
  const s = scores.get(id) ?? null;
  const t = tierOf(s);
  // Search results show the verdict label, not the number (the score is revealed on the page).
  const lead = [t?.label, s?.conf_track && paper.venue ? `${paper.venue} ${s.conf_track}` : null].filter(Boolean).join(" · ");
  const body = s?.tldr ?? s?.panel_consensus ?? paper.abstract ?? "";
  const description = [lead && `${lead}.`, body].filter(Boolean).join(" ").slice(0, 300);
  return {
    title: t ? `${tex(paper.title)} (${t.label})` : tex(paper.title),
    description: description || undefined,
    alternates: { canonical: `/paper/${id}` },
    openGraph: { type: "article", title: tex(paper.title), description: description || undefined, url: `/paper/${id}` },
  };
}

// Structured data for search engines: a scholarly article with its rating.
function articleJsonLd(paper: { id: string; title: string; authors: string[]; abstract: string | null; url: string | null; publishedOn: string | null; venue: string | null }, score: Score | null) {
  return {
    "@context": "https://schema.org",
    "@type": "ScholarlyArticle",
    headline: paper.title.slice(0, 110),
    name: paper.title,
    author: paper.authors.slice(0, 20).map((name) => ({ "@type": "Person", name })),
    ...(paper.abstract ? { abstract: paper.abstract } : {}),
    ...(paper.publishedOn ? { datePublished: paper.publishedOn } : {}),
    ...(paper.venue ? { isPartOf: { "@type": "Periodical", name: paper.venue } } : {}),
    ...(paper.url ? { sameAs: [paper.url, ...(score?.openreview_url && score.openreview_url !== paper.url ? [score.openreview_url] : [])] } : {}),
    url: `${SITE_URL}/paper/${paper.id}`,
    ...(score?.tldr ? { description: score.tldr } : {}),
  };
}

export default async function PaperPage({ params }: Props) {
  const { id } = await params;
  const paper = await getPaperAnywhere(id);
  if (!paper) notFound();

  const verdicts = (await getVerdicts([id])).get(id) ?? [];

  // Same arXiv paper already stored under its other id ("W…" or "arxiv-…"): go there.
  const aid = verdicts.length === 0 ? arxivIdOf(paper.url) : null;
  const stored = aid ? (await storedIdsByArxiv([aid]).catch(() => new Map<string, string>())).get(aid) : undefined;
  if (stored && stored !== id) redirect(`/paper/${stored}`);

  // A paper with no AI verdicts yet is judged once a reader has the page open for a few
  // seconds (components/WarmUp.tsx, /api/warm), not while rendering: crawlers fetching
  // thousands of paper pages used to spend the whole judging budget.
  const score = (await getScores([id])).get(id) ?? null;

  return (
    <main className="wrap page paper-page">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(articleJsonLd(paper, score)).replace(/</g, "\\u003c") }} />
      <PaperHero
        paper={{ ...paper, tags: paper.tags.length ? paper.tags : score?.tags ?? [], orgs: paper.orgs.length ? paper.orgs : score?.orgs ?? [] }}
        score={score}
        verdicts={verdicts}
        scoreOpen={(await openScoreIds().catch(() => [] as string[])).includes(id)}
      />
      <NoteBox paperId={paper.id} />
      <ReadTracker paperId={paper.id} />
      {(verdicts.length === 0 ? !!paper.abstract : !score?.comments) && <WarmUp id={paper.id} unjudged={verdicts.length === 0} />}
      <div className="paper-cols">
        {paper.abstract && (
          <section className="abstract">
            <h2>Abstract</h2>
            <p>{tex(paper.abstract)}</p>
          </section>
        )}
        <Comments
          paper={{ id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, url: paper.url }}
        />
      </div>
    </main>
  );
}
