import type { Metadata } from "next";
import Link from "next/link";
import { Gauge } from "@/components/Score";
import { AREA_GROUPS } from "@/lib/areas";
import { RESEARCHER, rankResearchers } from "@/lib/researchers";
import { TIERS } from "@/lib/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Good researchers",
  description: "Researchers whose papers readers and the AI panel rate highest, by area.",
};

type Props = { searchParams: Promise<{ area?: string }> };

const tone = (score: number) => (TIERS.find((t) => score >= t.min) ?? TIERS[TIERS.length - 1]).tone;
const compact = (n: number | null) =>
  n == null ? "–" : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

export default async function ResearchersPage({ searchParams }: Props) {
  const { area } = await searchParams;
  const group = area && AREA_GROUPS[area] && area !== "other" ? area : null;
  const list = await rankResearchers(group);

  return (
    <main className="wrap page">
      <h1 className="page-title">Good researchers</h1>
      <p className="page-sub">
        Ranked by how readers and the AI panel rate their papers here, with recent citations as the starting
        point. Only researchers with {RESEARCHER.MIN_PAPERS}+ rated papers{group ? " in this area" : ""}.{" "}
        <Link href="/how#researchers">How this works</Link>
      </p>

      <nav className="area-chips" aria-label="Area">
        <Link href="/researchers" aria-current={!group ? "page" : undefined}>All areas</Link>
        {Object.entries(AREA_GROUPS)
          .filter(([k]) => k !== "other")
          .map(([k, g]) => (
            <Link key={k} href={`/researchers?area=${k}`} aria-current={group === k ? "page" : undefined}>
              {g.label}
            </Link>
          ))}
      </nav>

      {list.length === 0 ? (
        <p className="empty">Not enough rated papers {group ? "in this area " : ""}yet. Check back as more papers get rated.</p>
      ) : (
        <ol className="researchers">
          {list.map((r, i) => (
            <li key={r.id} className="researcher">
              <span className="researcher-rank">{i + 1}</span>
              <Gauge pct={Math.round(r.score * 100)} tone={tone(r.score)} size="sm" />
              <div className="researcher-main">
                <Link href={`/author/${encodeURIComponent(r.name)}?from=${r.papers[0]?.id ?? ""}`} className="researcher-name">
                  {r.name}
                </Link>
                {r.institution && <span className="researcher-org">{r.institution}</span>}
                <ul className="researcher-papers">
                  {r.papers.map((p) => (
                    <li key={p.id}>
                      <Link href={`/paper/${p.id}`}>{p.title}</Link> <span className="researcher-pct">{Math.round(p.score * 100)}%</span>
                    </li>
                  ))}
                </ul>
              </div>
              <dl className="researcher-stats">
                <div><dt>Rated papers</dt><dd>{r.rated}</dd></div>
                <div><dt>Adjusted</dt><dd>{r.adjusted.toFixed(1)}</dd></div>
                <div><dt>Recent cites</dt><dd>{r.recentCitations == null ? "–" : r.recentCitations.toFixed(1)}</dd></div>
                <div><dt>h-index</dt><dd>{r.hIndex ?? "–"}</dd></div>
                <div><dt>Citations</dt><dd>{compact(r.citations)}</dd></div>
              </dl>
            </li>
          ))}
        </ol>
      )}
    </main>
  );
}
