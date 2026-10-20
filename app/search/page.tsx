import type { Metadata } from "next";
import Link from "next/link";
import { PaperRow } from "@/components/PaperRow";
import { findAuthors } from "@/lib/openalex";
import { findPapers } from "@/lib/search";
import { openScoreIds } from "@/lib/trending";

export const dynamic = "force-dynamic";

type Props = { searchParams: Promise<{ q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Search: ${q}` : "Search" };
}

export default async function SearchPage({ searchParams }: Props) {
  const openIds = await openScoreIds().catch(() => [] as string[]);
  const { q = "" } = await searchParams;
  const query = q.trim();

  const [{ results, scores, failed }, authors] = await Promise.all([
    findPapers(query),
    findAuthors(query).catch(() => []),
  ]);

  return (
    <main className="wrap page">
      <h1 className="page-title">{query ? `Papers matching “${query}”` : "Search papers"}</h1>
      {!query && <p className="empty">Type a title, author, or topic in the search box above.</p>}
      {authors.length > 0 && (
        <section className="author-hits" aria-label="Authors">
          <h2>
            {authors.length === 1 ? "Author" : `${authors.length} authors`} named {authors[0].name}
          </h2>
          <ul>
            {authors.map((a) => (
              <li key={a.ids[0]}>
                <Link href={`/author/${encodeURIComponent(a.name)}?a=${a.ids.join(",")}`} rel="nofollow">
                  <b>{a.name}</b>
                  <span>{[a.institution, a.topic].filter(Boolean).join(" · ") || "Institution unknown"}</span>
                  <small>{a.works.toLocaleString("en-US")} papers</small>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      {failed && <p className="empty">Paper search isn&apos;t responding. Try again in a minute.</p>}
      {query && !failed && results.length === 0 && (
        <p className="empty">No papers match that. Try fewer words or the exact title.</p>
      )}
      {results.length > 0 && (
        <ul className="paper-list">
          {results.map((p) => (
            <PaperRow key={p.id} {...p} score={scores.get(p.id) ?? null} scoreOpen={openIds.includes(p.id)} />
          ))}
        </ul>
      )}
    </main>
  );
}
