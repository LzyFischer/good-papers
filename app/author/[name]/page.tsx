import type { Metadata } from "next";
import { PaperList } from "@/components/PaperList";
import { getAuthorWorks } from "@/lib/openalex";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ name: string }>; searchParams: Promise<{ from?: string; page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { title: decodeURIComponent((await params).name) };
}

export default async function AuthorPage({ params, searchParams }: Props) {
  const name = decodeURIComponent((await params).name);
  const { from = null, page = "1" } = await searchParams;
  const p = Math.max(1, Number(page) || 1);
  const a = await getAuthorWorks(name, from, p).catch(() => null);
  const base = `/author/${encodeURIComponent(name)}${from ? `?from=${from}` : ""}`;
  return (
    <main className="wrap page">
      <h1 className="page-title">{a?.name ?? name}</h1>
      {a && (
        <p className="page-sub">
          {a.total.toLocaleString("en-US")} paper{a.total === 1 ? "" : "s"}
          {a.institutions.length > 0 && ` · ${a.institutions.join(", ")}`}
          {a.records > 1 && ` · merged from ${a.records} OpenAlex author records`}
        </p>
      )}
      {a ? <PaperList papers={a.papers} total={a.total} page={p} baseHref={base} /> : <p className="empty">OpenAlex isn&apos;t responding. Try again in a minute.</p>}
    </main>
  );
}
