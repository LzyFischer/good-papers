import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PaperCard } from "@/components/PaperCard";
import { getVerdicts } from "@/lib/papers";
import { WINDOWS, WINDOW_LABELS, shelf, trending, type Window } from "@/lib/trending";

export const dynamic = "force-dynamic";

// The full lists behind the home page shelves ("See all"), like Hugging Face's papers pages.
const KINDS = {
  trending: { title: "Trending", note: "What readers here and on Hugging Face are upvoting" },
  "must-read": { title: "Must read", note: "This year's highest-rated papers" },
  debated: { title: "Most debated", note: "Where the reviewers can't agree" },
} as const;
type Kind = keyof typeof KINDS;

type Props = { params: Promise<{ kind: string }>; searchParams: Promise<{ t?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { kind } = await params;
  return { title: KINDS[kind as Kind]?.title ?? "Papers" };
}

export default async function ShelfPage({ params, searchParams }: Props) {
  const { kind } = await params;
  if (!(kind in KINDS)) notFound();
  const { t } = await searchParams;
  const window: Window = t && t in WINDOWS ? (t as Window) : "week";
  const papers =
    kind === "trending" ? await trending(window, 100) : await shelf(kind === "must-read" ? "must" : "debated", 100);
  const verdicts = await getVerdicts(papers.map((p) => p.id));
  const k = KINDS[kind as Kind];

  return (
    <main className="wrap page">
      <div className="section-head">
        <h1 className="page-title">{k.title}</h1>
        {kind === "trending" && (
          <nav className="seg" aria-label="Trending window">
            {(Object.keys(WINDOWS) as Window[]).map((w) => (
              <Link key={w} href={`/shelf/trending?t=${w}`} aria-current={w === window ? "page" : undefined}>
                {WINDOW_LABELS[w]}
              </Link>
            ))}
          </nav>
        )}
      </div>
      <p className="page-sub">{k.note}</p>
      <section aria-label="Papers" className="all-papers">
        {papers.length === 0 ? (
          <p className="empty">Nothing here yet.</p>
        ) : (
          papers.map((s) => <PaperCard key={s.id} paper={s} score={s} verdicts={verdicts.get(s.id) ?? []} />)
        )}
      </section>
    </main>
  );
}
