import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Comments } from "@/components/Comments";
import { NoteBox } from "@/components/NoteBox";
import { PaperCard } from "@/components/PaperCard";
import { jevConfigured } from "@/lib/jev";
import { judgePaper } from "@/lib/judge";
import { getPaperAnywhere, getScores, getVerdicts, storeJudgement } from "@/lib/papers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

type Props = { params: Promise<{ id: string }> };

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
  if (verdicts.length === 0 && paper.abstract && jevConfigured() && process.env.SUPABASE_SERVICE_ROLE_KEY) {
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
      <PaperCard
        paper={{ ...paper, tags: paper.tags.length ? paper.tags : score?.tags ?? [] }}
        score={score}
        verdicts={verdicts}
        linkTitle={false}
        openPanel
      />
      <NoteBox paperId={paper.id} />
      {paper.abstract && (
        <section className="abstract">
          <h2>Abstract</h2>
          <p>{paper.abstract}</p>
        </section>
      )}
      <Comments
        paper={{ id: paper.id, title: paper.title, authors: paper.authors, year: paper.year, venue: paper.venue, url: paper.url }}
      />
    </main>
  );
}
