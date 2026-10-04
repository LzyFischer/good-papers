import Link from "next/link";
import { Icon } from "@/components/Icons";
import { PaperCard } from "@/components/PaperCard";
import { AREAS } from "@/lib/areas";
import { getVerdicts } from "@/lib/papers";
import { PERSONAS, PERSONA_IDS, type PersonaId } from "@/lib/personas";
import { serverClient } from "@/lib/supabase";
import { FRESH_THRESHOLD, SCORING, type Score } from "@/lib/types";

export const dynamic = "force-dynamic";

const PERSONA_COUNT = PERSONA_IDS.length;

type Props = { searchParams: Promise<{ area?: string }> };

export default async function Home({ searchParams }: Props) {
  const { area } = await searchParams;
  const activeArea = area && AREAS[area] ? area : null;

  let q = serverClient()
    .from("paper_scores")
    .select("*")
    .not("score", "is", null)
    .order("published_on", { ascending: false, nullsFirst: false })
    .order("last_activity", { ascending: false })
    .limit(30);
  if (activeArea) q = q.eq("area", activeArea);
  const { data } = await q;
  const papers = (data ?? []) as Score[];
  const verdicts = await getVerdicts(papers.map((p) => p.id));

  const { data: hotRows } = await serverClient()
    .from("ai_verdicts")
    .select("persona, take, paper_id, papers(title)")
    .not("take", "is", null)
    .eq("fresh", false)
    .order("created_at", { ascending: false })
    .limit(4);
  const hot = (hotRows ?? []) as unknown as {
    persona: PersonaId;
    take: string;
    paper_id: string;
    papers: { title: string } | null;
  }[];

  return (
    <main className="wrap">
      <section className="intro">
        <h1>Fresh or rotten? The newest papers, judged.</h1>
        <p>
          Every paper is scored by readers like you, with an AI panel of {PERSONA_COUNT} reviewer personas to get it
          started. Vote on the ones you&apos;ve read.
        </p>
      </section>

      <div className="layout">
        <section aria-label="Papers">
          {activeArea && (
            <p className="filter">
              Showing <b>{AREAS[activeArea].label}</b> <Link href="/">Show all papers</Link>
            </p>
          )}

          {papers.length === 0 ? (
            <p className="empty">
              No judged papers{activeArea ? " in this area" : ""} yet. Search for a paper you&apos;ve read and add the
              first verdict.
            </p>
          ) : (
            papers.map((s) => <PaperCard key={s.id} paper={s} score={s} verdicts={verdicts.get(s.id) ?? []} />)
          )}
        </section>

        <aside className="side">
          {hot.length > 0 && (
            <div className="box">
              <h2>Hot takes</h2>
              <ul className="hot">
                {hot.map((h) => (
                  <li key={`${h.paper_id}-${h.persona}`}>
                    <q>{h.take}</q>
                    <span>
                      {PERSONAS[h.persona]?.name ?? h.persona} on{" "}
                      <Link href={`/paper/${h.paper_id}`}>{h.papers?.title.split(":")[0] ?? "this paper"}</Link>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="box">
            <h2>How to read a score</h2>
            <ul className="legend">
              <li><Icon name="fresh" />Fresh: score of {Math.round(FRESH_THRESHOLD * 100)}% or more</li>
              <li><Icon name="rotten" />Rotten: under {Math.round(FRESH_THRESHOLD * 100)}%</li>
              <li><Icon name="readers" />Readers: signed-in people who read the paper. They decide the score once enough have voted.</li>
              <li>
                <Icon name="ai" />
                AI panel: {PERSONA_COUNT} reviewer personas, from lenient to strict. They count for {Math.round(SCORING.AI_WEIGHT * 100)}% and
                stand in for readers until there are enough votes.
              </li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
