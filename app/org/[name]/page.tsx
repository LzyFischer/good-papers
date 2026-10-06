import type { Metadata } from "next";
import { PaperList } from "@/components/PaperList";
import { getInstitutionWorks } from "@/lib/openalex";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ name: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { robots: { index: false, follow: false }, title: decodeURIComponent((await params).name) };
}

export default async function OrgPage({ params, searchParams }: Props) {
  const name = decodeURIComponent((await params).name);
  const p = Math.max(1, Number((await searchParams).page) || 1);
  const o = await getInstitutionWorks(name, p).catch(() => null);
  return (
    <main className="wrap page">
      <h1 className="page-title">{o?.name ?? name}</h1>
      {o && (
        <p className="page-sub">
          {o.total.toLocaleString("en-US")} paper{o.total === 1 ? "" : "s"}, newest first
          {!o.matched && " · matched by affiliation text"}
        </p>
      )}
      {o ? (
        <PaperList papers={o.papers} total={o.total} page={p} baseHref={`/org/${encodeURIComponent(name)}`} />
      ) : (
        <p className="empty">OpenAlex isn&apos;t responding. Try again in a minute.</p>
      )}
    </main>
  );
}
