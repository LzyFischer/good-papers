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

// A ranked list: name, a bar for the number of papers, and the number.
function WhoList({ title, rows }: { title: string; rows: { name: string; papers: number; href: string }[] }) {
  if (!rows.length) return null;
  const top = Math.max(...rows.map((r) => r.papers));
  return (
    <section className="who-panel">
      <h2>{title}</h2>
      <ol>
        {rows.map((r, i) => (
          <li key={r.name} className={i < 3 ? "who-top" : undefined}>
            <span className="who-rank">{i + 1}</span>
            <span className="who-main">
              <Link href={r.href} rel="nofollow">{r.name}</Link>
              <span className="who-bar" style={{ ["--w" as string]: `${Math.round((r.papers / top) * 100)}%` }} />
            </span>
            <span className="who-n">{r.papers}</span>
          </li>
        ))}
      </ol>
    </section>
  );
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
              <WhoList title="People" rows={a.people.map((p) => ({ ...p, href: `/author/${encodeURIComponent(p.name)}` }))} />
              <WhoList title="Institutions" rows={a.orgs.map((o) => ({ ...o, href: `/?org=${encodeURIComponent(o.name)}` }))} />
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
