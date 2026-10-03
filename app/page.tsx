import Link from "next/link";
import { Icon } from "@/components/Icons";
import { PaperCard } from "@/components/PaperCard";
import { AREAS } from "@/lib/areas";
import { getVerdicts } from "@/lib/papers";
import { PERSONAS, type PersonaId } from "@/lib/personas";
import { serverClient } from "@/lib/supabase";
import type { Score } from "@/lib/types";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ area?: string }> };

export default async function Home({ searchParams }: Props) {
  const { area } = await searchParams;
  const activeArea = area && AREAS[area] ? area : null;

  let q = serverClient()
    .from("paper_scores")
    .select("*")
    .gt("total", 0)
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
          Every paper gets three verdicts: readers like you, an AI panel of five reviewer personalities, and conference
          reviewers. Vote on the ones you&apos;ve read.
        </p>
      </section>

      <div className="layout">
        <section aria-label="Papers">
          <nav className="tabs" aria-label="Filter by area">
            <Link href="/" className="tab" aria-current={!activeArea ? "page" : undefined}>
              All
            </Link>
            {Object.entries(AREAS)
              .filter(([k]) => k !== "other")
              .map(([k, a]) => (
                <Link key={k} href={`/?area=${k}`} className="tab" aria-current={activeArea === k ? "page" : undefined}>
                  {a.label}
                </Link>
              ))}
          </nav>

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
              <li><Icon name="fresh" />Fresh: at least 60% of verdicts say worth reading</li>
              <li><Icon name="rotten" />Rotten: under 60%</li>
              <li><Icon name="readers" />Readers who signed in and voted</li>
              <li><Icon name="ai" />AI panel: five reviewer personalities</li>
              <li><Icon name="reviewer" />Conference reviewers</li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
