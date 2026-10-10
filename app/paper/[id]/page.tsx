import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Comments } from "@/components/Comments";
import { NoteBox } from "@/components/NoteBox";
import { ReadTracker } from "@/components/ReadTracker";
import { PaperHero } from "@/components/PaperHero";
import { tierOf } from "@/components/Score";
import { jevConfigured } from "@/lib/jev";
import { judgePaper } from "@/lib/judge";
import { arxivIdOf } from "@/lib/arxiv";
import { getPaperAnywhere, getScores, getVerdicts, refreshAiCurve, storeJudgement, storedIdsByArxiv, underInlineBudget } from "@/lib/papers";
import { nudgeWorker } from "@/lib/dispatch";
import { openScoreIds } from "@/lib/trending";
import { SITE_URL } from "@/lib/site";
import { adminClient } from "@/lib/supabase";
import type { Score } from "@/lib/types";

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
    title: t ? `${paper.title} (${t.label})` : paper.title,
    description: description || undefined,
    alternates: { canonical: `/paper/${id}` },
    openGraph: { type: "article", title: paper.title, description: description || undefined, url: `/paper/${id}` },
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

  let verdicts = (await getVerdicts([id])).get(id) ?? [];

  // Same arXiv paper already stored under its other id ("W…" or "arxiv-…"): go there.
  const aid = verdicts.length === 0 ? arxivIdOf(paper.url) : null;
  const stored = aid ? (await storedIdsByArxiv([aid]).catch(() => new Map<string, string>())).get(aid) : undefined;
  if (stored && stored !== id) redirect(`/paper/${stored}`);

  // AI warm start: the first visit to an unjudged paper asks Jev (fast, no takes).
  // The daily cron writes the one-line takes afterwards.
  if (verdicts.length === 0 && paper.abstract && jevConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY && (await underInlineBudget())) {
    try {
      await storeJudgement(paper, await judgePaper(paper, { withTakes: false }));
      await refreshAiCurve();
      verdicts = (await getVerdicts([id])).get(id) ?? [];
      await nudgeWorker(); // AI discussion, TL;DR and consensus follow in a couple of minutes
    } catch (e) {
      console.warn("Inline judging failed:", e);
    }
  }
  const score = (await getScores([id])).get(id) ?? null;

  // Bulk-imported conference papers get their AI discussion when someone first opens them.
  if (score && score.comments === 0 && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const db = adminClient();
    const { data: flags } = await db.from("papers").select("discuss_on_demand, discuss_requested_at").eq("id", id).maybeSingle();
    if (flags?.discuss_on_demand && !flags.discuss_requested_at) {
      await db.from("papers").update({ discuss_requested_at: new Date().toISOString() }).eq("id", id);
      await nudgeWorker();
    }
  }

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
      <div className="paper-cols">
        {paper.abstract && (
          <section className="abstract">
            <h2>Abstract</h2>
            <p>{paper.abstract}</p>
          </section>
        )}
        <Comments
          paper={{ id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, url: paper.url }}
        />
      </div>
    </main>
  );
}
