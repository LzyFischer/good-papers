import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PaperList } from "@/components/PaperList";
import { AREAS } from "@/lib/areas";
import { searchTopicWorks } from "@/lib/openalex";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ key: string }>; searchParams: Promise<{ page?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  return { robots: { index: false, follow: false }, title: AREAS[(await params).key]?.label ?? "Area" };
}

export default async function AreaPage({ params, searchParams }: Props) {
  const { key } = await params;
  const area = AREAS[key];
  if (!area) notFound();
  const p = Math.max(1, Number((await searchParams).page) || 1);
  const r = await searchTopicWorks(area.label, p).catch(() => null);
  return (
    <main className="wrap page">
      <h1 className="page-title">{area.label}</h1>
      {r && <p className="page-sub">{r.total.toLocaleString("en-US")} papers from the last two years, most relevant first</p>}
      {r ? (
        <PaperList papers={r.papers} total={r.total} page={p} baseHref={`/area/${key}`} />
      ) : (
        <p className="empty">OpenAlex isn&apos;t responding. Try again in a minute.</p>
      )}
    </main>
  );
}
