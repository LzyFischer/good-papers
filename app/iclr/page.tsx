import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IclrDistribution, IclrStanding } from "@/components/IclrStanding";
import { IclrTopics } from "@/components/IclrTopics";
import { ICLR_YEAR, iclrPaper, iclrPool, iclrSearch, iclrStats, iclrTopics, openreviewId } from "@/lib/iclr";
import { ICLR_COPY, type IclrCopy, type Lang } from "@/lib/iclrCopy";

type Props = { searchParams: Promise<{ id?: string; q?: string; lang?: string }> };

/** ?lang=zh|en wins; otherwise a browser that prefers Chinese gets Chinese. */
async function langOf(param?: string): Promise<Lang> {
  if (param === "zh" || param === "en") return param;
  return /^zh\b/i.test((await headers()).get("accept-language") ?? "") ? "zh" : "en";
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { id, q, lang } = await searchParams;
  const zh = (await langOf(lang)) === "zh";
  return {
    title: ICLR_COPY[zh ? "zh" : "en"].title(ICLR_YEAR),
    description: zh
      ? `每篇 ICLR ${ICLR_YEAR} 投稿的录用概率、分数排名和模拟 AC 批次，基于 OpenReview 公开分数。`
      : `Chance of acceptance, score rank and a simulated area-chair batch for every ICLR ${ICLR_YEAR} submission, from public OpenReview scores.`,
    // submissions under review are anonymous: keep single-paper and search views out of search engines
    ...(id || q ? { robots: { index: false, follow: false } } : {}),
  };
}

function Findings({ t }: { t: IclrCopy }) {
  const f = t.f;
  return (
    <section className="iclr-finding" aria-label={f.title}>
      <h2>{f.title}</h2>
      <p>{f.intro}</p>
      <h3>{f.batchH}</h3>
      <p>{f.batchP}</p>
      <div className="iclr-ft">
        {[["2024", "49.7% / 49.8%"], ["2025", "47.0% / 49.9%"], ["2026", "42.5% / 44.5%"]].map(([y, v]) => (
          <div key={y}><small>{y}</small><b>{v}</b><span>{f.batchLabel}</span></div>
        ))}
      </div>
      <h3>{f.areaH}</h3>
      <p>{f.areaP}</p>
      <h3>{f.agreeH}</h3>
      <div className="iclr-ft">
        {[["2024", "87% / 63%"], ["2025", "61% / 36%"], ["2026", "43% / 36%"]].map(([y, v]) => (
          <div key={y}><small>{y}</small><b>{v}</b><span>{f.agreeLabel}</span></div>
        ))}
      </div>
      <p>{f.agreeP}</p>
    </section>
  );
}

export default async function IclrPage({ searchParams }: Props) {
  const { id, q = "", lang: langParam } = await searchParams;
  const lang = await langOf(langParam);
  const t = ICLR_COPY[lang];
  const zh = lang === "zh" ? "&lang=zh" : "";
  const query = q.trim();
  const pasted = query ? openreviewId(query) : null;
  if (pasted && !id) redirect(`/iclr?id=${pasted}${zh}`);

  // the switch keeps the paper or search in view
  const here = new URLSearchParams({ ...(id ? { id } : {}), ...(query ? { q: query } : {}), lang: lang === "zh" ? "en" : "zh" });
  const Switch = <Link className="iclr-lang" href={`/iclr?${here}`} hrefLang={lang === "zh" ? "en" : "zh"}>{t.switchTo}</Link>;

  const stats = await iclrStats();
  if (!stats) {
    return (
      <main className="wrap page iclr" lang={lang === "zh" ? "zh-CN" : "en"}>
        <h1 className="page-title">{t.title(ICLR_YEAR)}</h1>
        <p className="empty">{t.notLoaded}</p>
      </main>
    );
  }
  const s = stats.data;
  const paper = id ? await iclrPaper(id) : null;
  if (id && !paper) notFound();
  const pool = paper ? await iclrPool(paper.neighbors) : [];
  const results = !paper && query ? await iclrSearch(query) : [];
  const topics = !paper && !query ? await iclrTopics() : null;
  const updated = new Date(stats.updated_at).toLocaleDateString(lang === "zh" ? "zh-CN" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <main className="wrap page iclr" lang={lang === "zh" ? "zh-CN" : "en"}>
      {paper ? (
        <div className="iclr-top"><p className="iclr-crumb"><Link href={`/iclr${zh ? "?lang=zh" : ""}`}>{t.crumb(ICLR_YEAR)}</Link></p>{Switch}</div>
      ) : (
        <>
          <div className="iclr-top"><h1 className="page-title">{t.title(ICLR_YEAR)}</h1>{Switch}</div>
          <p className="iclr-lede">
            {t.lede(s.counts.submitted, s.counts.withdrawn)}{" "}
            <a href="https://papercopilot.com" target="_blank" rel="noopener noreferrer">Paper Copilot</a>{t.ledeTail(updated)}
          </p>
        </>
      )}

      <form className="iclr-search" action="/iclr">
        <input name="q" defaultValue={paper ? "" : query} placeholder={t.placeholder} aria-label={t.placeholder} />
        {lang === "zh" && <input type="hidden" name="lang" value="zh" />}
        <button type="submit">{t.find}</button>
      </form>

      {query && !paper && (
        results.length ? (
          <ul className="iclr-results">
            {results.map((r) => (
              <li key={r.id}>
                <Link href={`/iclr?id=${r.id}${zh}`}>{r.title}</Link>
                <span>{r.outcome === "pending" ? r.ratings.join(" · ") || t.noReviews : t.outcomeShort[r.outcome] ?? r.outcome}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">{t.noMatch(ICLR_YEAR)}</p>
        )
      )}

      {paper ? (
        paper.outcome !== "pending" || paper.ratings.length < 3 ? (
          <section className="iclr-card">
            <h1 className="iclr-title">{paper.title}</h1>
            <p className="empty">{t.outcome[paper.outcome] ?? t.tooFew}</p>
          </section>
        ) : (
          <IclrStanding lang={lang} stats={s} title={paper.title} area={paper.area} ratings={paper.ratings} confidences={paper.confidences}
            pool={pool} similarLast={paper.similar_last} />
        )
      ) : (
        !query && (
          <>
          <section className="iclr-card" aria-label={t.allTitle}>
            <div className="iclr-bh">
              <h2>{t.allTitle}</h2>
              <p>{t.allNote(s.counts.reviewed, s.scale[0], s.scale[1])}</p>
            </div>
            <IclrDistribution stats={s} you={t.you} />
          </section>
          {topics && <IclrTopics data={topics} lang={lang} />}
          </>
        )
      )}

      <Findings t={t} />
      <p className="iclr-note">{t.foot(ICLR_YEAR, s.scale[0], s.scale[1])}</p>
    </main>
  );
}
