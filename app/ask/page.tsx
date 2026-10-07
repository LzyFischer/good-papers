import type { Metadata } from "next";
import Link from "next/link";
import { AskBox } from "@/components/AskBox";
import { MiniCard } from "@/components/Shelf";
import { ask, INTENTS } from "@/lib/ask";
import { openScoreIds } from "@/lib/trending";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type Props = { searchParams: Promise<{ q?: string; n?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { q } = await searchParams;
  return { title: q ? `Ask: ${q}` : "Ask" };
}

export default async function AskPage({ searchParams }: Props) {
  const openIds = await openScoreIds().catch(() => [] as string[]);
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 300);
  const shown = Math.min(400, Math.max(40, Number(sp.n) || 40));
  const a = q ? await ask(q, shown).catch(() => null) : null;
  return (
    <main className="wrap page">
      <AskBox value={q} />
      {q && !a && <p className="empty">The question parser isn&apos;t responding. Try again in a minute.</p>}
      {a && (
        <>
          <p className="ask-read">
            Reading this as <b>{INTENTS[a.intent].label}</b>
            {a.area && (
              <>
                {" "}in {a.area.group ? <b>{a.area.label}</b> : <Link href={`/?area=${a.area.key}`}>{a.area.label}</Link>}
              </>
            )}
            {a.venue ? (
              <>
                , at <b>{a.venue}</b>
                {a.track && <> ({a.track}s)</>}
              </>
            ) : (
              <>
                , <b>{a.windowLabel}</b>
              </>
            )}
            . Answers come from ratings and discussions on Good Papers.
          </p>
          {a.intent === "who" && (a.people.length > 0 || a.orgs.length > 0) && (
            <div className="who">
              <div>
                <h2>People</h2>
                <ol>
                  {a.people.map((p) => (
                    <li key={p.name}>
                      <Link href={`/author/${encodeURIComponent(p.name)}`}>{p.name}</Link> <span>{p.papers} paper{p.papers === 1 ? "" : "s"}</span>
                    </li>
                  ))}
                </ol>
              </div>
              <div>
                <h2>Institutions</h2>
                <ol>
                  {a.orgs.map((o) => (
                    <li key={o.name}>
                      <Link href={`/?org=${encodeURIComponent(o.name)}`}>{o.name}</Link> <span>{o.papers} paper{o.papers === 1 ? "" : "s"}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}
          {a.papers.length > 0 ? (
            <div className="grid-cards">
              {a.papers.map((s, i) => (
                <div key={s.id} id={`p${i}`} className="card-anchor">
                  <MiniCard s={s} scoreOpen={openIds.includes(s.id)} />
                </div>
              ))}
            </div>
          ) : null}
          {a.more && (
            <Link href={`/ask?q=${encodeURIComponent(q)}&n=${shown + 40}`} className="load-more" scroll={false}>
              Show 40 more papers
            </Link>
          )}
          {a.papers.length === 0 && (
            <p className="empty">
              No rated papers match yet.{" "}
              {a.area && !a.area.group && <Link href={`/?area=${a.area.key}`}>See all rated {a.area.label} papers</Link>}
            </p>
          )}
        </>
      )}
    </main>
  );
}
