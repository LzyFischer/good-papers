import Link from "next/link";
import { cookies } from "next/headers";
import { after } from "next/server";
import { AskBox } from "@/components/AskBox";
import { AutoMore } from "@/components/AutoMore";
import { ForYou } from "@/components/ForYou";
import { HeroDeck } from "@/components/HeroDeck";
import { PaperListCard } from "@/components/PaperListCard";
import { Shelf } from "@/components/Shelf";
import { AREAS } from "@/lib/areas";
import { mergeByTopics, topicGroups, topicsFromCookie, TOPICS_COOKIE } from "@/lib/forYou";
import { topUpTrending } from "@/lib/ingest";
import { toDeckCard, type DeckCard } from "@/lib/deck";
import { NEURIPS } from "@/lib/neurips";
import { serverClient } from "@/lib/supabase";
import { WINDOWS, WINDOW_LABELS, homeShelves, oneTitleEach, openScoreIds, pickPaperOfTheDay, type Window } from "@/lib/trending";
import type { Score } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 60; // room for the trending top-up after the page is sent


type Props = { searchParams: Promise<{ area?: string; org?: string; author?: string; t?: string; n?: string }> };

const PAGE = 20; // papers per page; more load as you scroll (AutoMore)

// PostgREST array "contains" with a quoted element, so names with commas or spaces work.
const arrayHas = (v: string) => `{"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"}`;

export default async function Home({ searchParams }: Props) {
  const { area, org, author, t, n } = await searchParams;
  const shown = Math.min(1000, Math.max(PAGE, Math.round((Number(n) || PAGE) / PAGE) * PAGE));
  const window: Window = t && t in WINDOWS ? (t as Window) : "week";
  const activeArea = area && AREAS[area] ? area : null;

  const list = () =>
    serverClient()
      .from("paper_scores")
      .select("*")
      .not("score", "is", null)
      .not("area", "is", null) // in-scope (ML) papers only; others can come in from author/institution pages
      .order("published_on", { ascending: false, nullsFirst: false })
      .order("last_activity", { ascending: false })
      .order("id")
      .limit(shown + 1); // one extra tells us whether there are more
  let q = list();
  if (activeArea) q = q.eq("area", activeArea);
  if (org) q = q.filter("orgs", "cs", arrayHas(org));
  if (author) q = q.filter("authors", "cs", arrayHas(author));
  const filtered = activeArea ? AREAS[activeArea].label : org ? `papers from ${org}` : author ? `papers by ${author}` : null;
  // Signed-in readers: papers in their topics move up (lib/forYou.ts, mergeByTopics).
  const topics = filtered ? new Map<string, number>() : topicsFromCookie((await cookies()).get(TOPICS_COOKIE)?.value);
  const [{ data }, ...mine] = await Promise.all([
    q,
    ...topicGroups(topics).flatMap((keys) => [list().in("area", keys), list().in("area", keys).is("published_on", null)]),
  ]);
  const ranked = topics.size
    ? mergeByTopics([(data ?? []) as Score[], ...mine.map((r) => (r.data ?? []) as Score[])], topics, shown + 1)
    : ((data ?? []) as Score[]);
  const hasMore = ranked.length > shown;
  const papers = ranked.slice(0, shown);
  const moreHref = (() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ area, org, author, t })) if (v) p.set(k, v);
    p.set("n", String(shown + PAGE));
    return `/?${p}`; // scroll={false} keeps your place; new papers appear below
  })();
  const openIds = await openScoreIds().catch(() => [] as string[]);

  const browsing = !filtered;
  if (browsing) after(() => topUpTrending().catch((e) => console.warn("Trending top-up failed:", e)));
  const [hotNow, must, debated, nips] = browsing ? await homeShelves(window) : [[], [], [], []];
  const week = browsing ? (window === "week" ? hotNow : (await homeShelves("week"))[0]) : [];
  const spot = pickPaperOfTheDay(week) ?? must[0];
  // The hero deck starts with the paper of the day and this week's trending; HeroDeck mixes in
  // For you and then pages of recent papers (/api/deck) as the visitor swipes on.
  const deck: DeckCard[] = oneTitleEach([spot, ...week].filter((p): p is Score => Boolean(p))).map((p, k) =>
    toDeckCard(p, k === 0 ? "Paper of the day" : "Trending this week", k === 0 || openIds.includes(p.id)),
  );

  return (
    <main>
      {browsing && (
        <section className="hero">
          <div className="wrap hero-in">
            <div className="hero-copy">
              <h1>
                Read the <span className="hl">good ones</span>.
              </h1>
              <p className="hero-lede">You decide which ones are good research papers.</p>
              <AskBox dark />
            </div>
            <HeroDeck cards={deck} />
          </div>
        </section>
      )}

      <div className="wrap home-body">
        {browsing && (
          <>
            <ForYou />
            <Shelf id="trending" title="Trending" note="What readers here and on Hugging Face are upvoting" papers={hotNow} openIds={openIds} more={{ href: `/shelf/trending?t=${window}`, label: "See all" }}>
              <nav className="seg" aria-label="Trending window">
                {(Object.keys(WINDOWS) as Window[]).map((w) => (
                  <Link key={w} href={w === "week" ? "/#trending" : `/?t=${w}#trending`} aria-current={w === window ? "page" : undefined} scroll={false}>
                    {WINDOW_LABELS[w]}
                  </Link>
                ))}
              </nav>
            </Shelf>
            <Shelf id="neurips" title={`Trending at ${NEURIPS}`} note="Orals, spotlights and posters people are talking about" papers={nips} openIds={openIds} more={{ href: "/neurips", label: "All sessions" }} />
            <Shelf id="must-read" title="Must read" note="This year's highest-rated papers" papers={must} openIds={openIds} more={{ href: "/shelf/must-read", label: "See all" }} />
            <Shelf id="debated" title="Most debated" note="Where the reviewers can't agree" papers={debated} openIds={openIds} more={{ href: "/shelf/debated", label: "See all" }} />
            <div className="section-head">
              <h2 className="section-title">All papers</h2>
              {topics.size ? <span className="section-note">Your topics first, then the newest</span> : <Link href="/how">How scores work</Link>}
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
            papers.map((s, i) => (
              <div key={s.id} id={`p${i}`} className="card-anchor">
                <PaperListCard s={s} scoreOpen={openIds.includes(s.id)} />
              </div>
            ))
          )}
        </section>
        {hasMore && (
          <AutoMore href={moreHref} label={`Show ${PAGE} more papers`} />
        )}
      </div>
    </main>
  );
}
