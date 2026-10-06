import Link from "next/link";
import { AskBox } from "@/components/AskBox";
import { PaperCard } from "@/components/PaperCard";
import { Gauge, tierOf } from "@/components/Score";
import { Shelf } from "@/components/Shelf";
import { AREAS } from "@/lib/areas";
import { getVerdicts } from "@/lib/papers";
import { serverClient } from "@/lib/supabase";
import { WINDOWS, shelf, trending, type Window } from "@/lib/trending";
import type { Score } from "@/lib/types";

export const dynamic = "force-dynamic";


type Props = { searchParams: Promise<{ area?: string; org?: string; author?: string; t?: string }> };

// PostgREST array "contains" with a quoted element, so names with commas or spaces work.
const arrayHas = (v: string) => `{"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"}`;

async function stats() {
  const db = serverClient();
  const weekAgo = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
  // (Reader votes aren't countable here: ratings are private under row-level security.)
  const [papers, comments, week] = await Promise.all([
    db.from("paper_scores").select("id", { count: "exact", head: true }).not("score", "is", null).not("area", "is", null),
    db.from("comments").select("id", { count: "exact", head: true }),
    db.from("paper_scores").select("id", { count: "exact", head: true }).not("area", "is", null).gte("published_on", weekAgo),
  ]);
  return { papers: papers.count ?? 0, comments: comments.count ?? 0, week: week.count ?? 0 };
}

// The paper at the top of the page: the hottest one this week that has a picture and a consensus line.
function Spotlight({ s }: { s: Score }) {
  const t = tierOf(s);
  return (
    <Link href={`/paper/${s.id}`} className="spot">
      <span className="spot-kicker">Paper of the day</span>
      {s.thumbnail && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={s.thumbnail} alt="" className="spot-img" />
      )}
      <span className="spot-body">
        {t && <Gauge pct={t.pct} tone={t.tone} />}
        <span>
          <span className="spot-tier">{t?.label}</span>
          <span className="spot-title">{s.title}</span>
        </span>
      </span>
      {s.panel_consensus ? <q className="spot-quote">{s.panel_consensus}</q> : s.tldr && <span className="spot-tldr">{s.tldr}</span>}
    </Link>
  );
}

export default async function Home({ searchParams }: Props) {
  const { area, org, author, t } = await searchParams;
  const window: Window = t && t in WINDOWS ? (t as Window) : "week";
  const activeArea = area && AREAS[area] ? area : null;

  let q = serverClient()
    .from("paper_scores")
    .select("*")
    .not("score", "is", null)
    .not("area", "is", null) // in-scope (ML) papers only; others can come in from author/institution pages
    .order("published_on", { ascending: false, nullsFirst: false })
    .order("last_activity", { ascending: false })
    .limit(30);
  if (activeArea) q = q.eq("area", activeArea);
  if (org) q = q.filter("orgs", "cs", arrayHas(org));
  if (author) q = q.filter("authors", "cs", arrayHas(author));
  const filtered = activeArea ? AREAS[activeArea].label : org ? `papers from ${org}` : author ? `papers by ${author}` : null;
  const { data } = await q;
  const papers = (data ?? []) as Score[];
  const verdicts = await getVerdicts(papers.map((p) => p.id));

  const browsing = !filtered;
  const [hotNow, must, debated, fresh, n] = browsing
    ? await Promise.all([trending(window), shelf("must"), shelf("debated"), shelf("new"), stats()])
    : [[], [], [], [], null];
  const spot = [...hotNow, ...must].find((s) => s.thumbnail && s.panel_consensus) ?? hotNow[0] ?? must[0];

  return (
    <main>
      {browsing && (
        <section className="hero">
          <div className="wrap hero-in">
            <div className="hero-copy">
              <h1>
                Read the <span className="hl">good ones</span>.
              </h1>
              <p className="hero-lede">Every new ML paper, rated. You decide which ones are good papers.</p>
              {n && (
                <p className="hero-stats">
                  <span><b>{n.papers.toLocaleString("en-US")}</b> papers rated</span>
                  <span><b>{n.comments.toLocaleString("en-US")}</b> comments</span>
                  <span><b>{n.week.toLocaleString("en-US")}</b> new this week</span>
                </p>
              )}
              <AskBox dark />
            </div>
            {spot && <Spotlight s={spot} />}
          </div>
        </section>
      )}

      <div className="wrap home-body">
        {browsing && (
          <>
            <Shelf id="trending" title="Trending" note="What readers here and on Hugging Face are upvoting" papers={hotNow}>
              <nav className="seg" aria-label="Trending window">
                {(Object.keys(WINDOWS) as Window[]).map((w) => (
                  <Link key={w} href={w === "week" ? "/#trending" : `/?t=${w}#trending`} aria-current={w === window ? "page" : undefined} scroll={false}>
                    {w === "day" ? "Today" : w === "week" ? "This week" : "This month"}
                  </Link>
                ))}
              </nav>
            </Shelf>
            <Shelf id="must-read" title="Must read" note="The top fifth of everything rated" papers={must} />
            <Shelf id="debated" title="Most debated" note="Where the reviewers can't agree" papers={debated} />
            <Shelf id="new" title="New today" note="Fresh off arXiv" papers={fresh} />
            <div className="section-head">
              <h2 className="section-title">All papers</h2>
              <Link href="/how">How scores work</Link>
            </div>
          </>
        )}

        {filtered && (
          <p className="filter">
            Showing <b>{filtered}</b> <Link href="/">Show all papers</Link>
          </p>
        )}
        <section aria-label="Papers" className="all-papers">
          {papers.length === 0 ? (
            <p className="empty">No rated papers{filtered ? " here" : ""} yet. Search for a paper you&apos;ve read and add the first verdict.</p>
          ) : (
            papers.map((s) => <PaperCard key={s.id} paper={s} score={s} verdicts={verdicts.get(s.id) ?? []} />)
          )}
        </section>
      </div>
    </main>
  );
}
