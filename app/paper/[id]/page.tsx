import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Comments } from "@/components/Comments";
import { NoteBox } from "@/components/NoteBox";
import { PaperHero } from "@/components/PaperHero";
import { jevConfigured } from "@/lib/jev";
import { judgePaper } from "@/lib/judge";
import { getPaperAnywhere, getScores, getVerdicts, storeJudgement } from "@/lib/papers";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Props = { params: Promise<{ id: string }> };

// Site-wide cap on papers judged on page view, so a crawler or a busy hour can't run up the Jev bill.
const INLINE_JUDGE_PER_HOUR = 120; // counts every new paper, including the daily cron's batch
async function underInlineBudget() {
  const { count } = await serverClient()
    .from("papers")
    .select("id", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - 3600_000).toISOString());
  return (count ?? 0) < INLINE_JUDGE_PER_HOUR;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const paper = await getPaperAnywhere(id).catch(() => null);
  return { title: paper?.title ?? "Paper" };
}

export default async function PaperPage({ params }: Props) {
  const { id } = await params;
  const paper = await getPaperAnywhere(id);
  if (!paper) notFound();

  let verdicts = (await getVerdicts([id])).get(id) ?? [];

  // AI warm start: the first visit to an unjudged paper asks Jev (fast, no takes).
  // The daily cron writes the one-line takes afterwards.
  if (verdicts.length === 0 && paper.abstract && jevConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY && (await underInlineBudget())) {
    try {
      await storeJudgement(paper, await judgePaper(paper, { withTakes: false }));
      verdicts = (await getVerdicts([id])).get(id) ?? [];
    } catch (e) {
      console.warn("Inline judging failed:", e);
    }
  }
  const score = (await getScores([id])).get(id) ?? null;

  return (
    <main className="wrap page paper-page">
      <PaperHero
        paper={{ ...paper, tags: paper.tags.length ? paper.tags : score?.tags ?? [], orgs: paper.orgs.length ? paper.orgs : score?.orgs ?? [] }}
        score={score}
        verdicts={verdicts}
      />
      <NoteBox paperId={paper.id} />
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
