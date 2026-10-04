import Link from "next/link";
import { Icon } from "@/components/Icons";
import { PaperCard } from "@/components/PaperCard";
import { AREAS } from "@/lib/areas";
import { getVerdicts } from "@/lib/papers";
import { PERSONA_IDS } from "@/lib/personas";
import { serverClient } from "@/lib/supabase";
import { FRESH_THRESHOLD, SCORING, type Score } from "@/lib/types";

export const dynamic = "force-dynamic";

const PERSONA_COUNT = PERSONA_IDS.length;

// Hot quotes: the sharpest recent comments, from readers and the AI panel alike.
// hot = Jev quote score × (1 + likes + replies / 2), decaying over about a week.
async function hotQuotes(n = 5) {
  const since = new Date(Date.now() - 30 * 86400_000).toISOString();
  const { data } = await serverClient()
    .from("comment_feed")
    .select("id, paper_id, author_kind, author_name, body, quote_score, likes, replies, created_at")
    .gte("quote_score", 0.6)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(300);
  type Row = {
    id: string; paper_id: string; author_kind: string; author_name: string | null; body: string;
    quote_score: number; likes: number; replies: number; created_at: string;
  };
  const top = ((data ?? []) as Row[])
    .map((c) => {
      const days = (Date.now() - Date.parse(c.created_at)) / 86400_000;
      return { c, hot: (c.quote_score * (1 + c.likes + c.replies / 2)) / (1 + days / 7) };
    })
    .sort((a, b) => b.hot - a.hot)
    .slice(0, n)
    .map(({ c }) => c);
  const { data: papers } = await serverClient()
    .from("papers")
    .select("id, title")
    .in("id", [...new Set(top.map((c) => c.paper_id))]);
  const titles = new Map((papers ?? []).map((p) => [p.id as string, (p.title as string).split(":")[0]]));
  return top.map((c) => ({
    id: c.id,
    paper_id: c.paper_id,
    title: titles.get(c.paper_id) ?? "this paper",
    author: c.author_name ?? "reader",
    ai: c.author_kind === "ai",
    likes: c.likes,
    replies: c.replies,
    quote: firstSentence(c.body),
  }));
}

function firstSentence(text: string, max = 180) {
  const m = text.match(/^.{20,}?[.!?](?=\s|$)/);
  const s = m ? m[0] : text;
  return s.length > max ? s.slice(0, max).replace(/\s+\S*$/, "") + "…" : s;
}

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

  const hot = await hotQuotes();

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
              <h2>Hot quotes</h2>
              <ul className="hot">
                {hot.map((h) => (
                  <li key={h.id}>
                    <q>{h.quote}</q>
                    <span>
                      {h.author}
                      {h.ai && <span className="ai-badge">AI</span>} on{" "}
                      <Link href={`/paper/${h.paper_id}`}>{h.title}</Link>
                      {(h.likes > 0 || h.replies > 0) && (
                        <>
                          {" "}
                          · {h.likes > 0 && `♥ ${h.likes}`}
                          {h.likes > 0 && h.replies > 0 && " · "}
                          {h.replies > 0 && `${h.replies} repl${h.replies === 1 ? "y" : "ies"}`}
                        </>
                      )}
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
