import type { Metadata } from "next";
import { PaperList } from "@/components/PaperList";
import { getAuthorWorks } from "@/lib/openalex";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ name: string }>; searchParams: Promise<{ from?: string; page?: string; a?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { robots: { index: false, follow: false }, title: decodeURIComponent((await params).name) };
}

const initials = (n: string) =>
  n.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

export default async function AuthorPage({ params, searchParams }: Props) {
  const name = decodeURIComponent((await params).name);
  const { from = null, page = "1", a: authorId = null } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const a = await getAuthorWorks(name, from, p, authorId).catch(() => null);
  const keep = new URLSearchParams({ ...(from ? { from } : {}), ...(authorId ? { a: authorId } : {}) }).toString();
  const base = `/author/${encodeURIComponent(name)}${keep ? `?${keep}` : ""}`;
  return (
    <main className="wrap page">
      <header className="profile">
        <span className="profile-initials" aria-hidden="true">{initials(a?.name ?? name)}</span>
        <div>
          <h1>{a?.name ?? name}</h1>
          {a && a.institutions.length > 0 && (
            <p className="profile-orgs">
              {a.institutions.map((o: string) => <span key={o}>{o}</span>)}
            </p>
          )}
        </div>
        {a && (
          <p className="profile-stat">
            <b>{a.total.toLocaleString("en-US")}</b> paper{a.total === 1 ? "" : "s"}
            {/* Scholar has no API and no ids to match on, so this opens its author search for the name. */}
            <a href={`https://scholar.google.com/citations?view_op=search_authors&mauthors=${encodeURIComponent(a.name)}`} target="_blank" rel="noopener noreferrer nofollow">
              Google Scholar ↗
            </a>
          </p>
        )}
      </header>
      {a ? <PaperList papers={a.papers} total={a.total} page={p} baseHref={base} /> : <p className="empty">OpenAlex isn&apos;t responding. Try again in a minute.</p>}
    </main>
  );
}
