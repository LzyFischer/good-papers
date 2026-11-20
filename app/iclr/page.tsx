import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { IclrDistribution, IclrStanding } from "@/components/IclrStanding";
import { ICLR_YEAR, iclrPaper, iclrPool, iclrSearch, iclrStats, openreviewId } from "@/lib/iclr";

export const revalidate = 3600;

type Props = { searchParams: Promise<{ id?: string; q?: string }> };

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const { id, q } = await searchParams;
  return {
    title: `ICLR ${ICLR_YEAR}: where does your paper stand?`,
    description: `Chance of acceptance, score rank and a simulated area-chair batch for every ICLR ${ICLR_YEAR} submission, from public OpenReview scores.`,
    // submissions under review are anonymous: keep single-paper and search views out of search engines
    ...(id || q ? { robots: { index: false, follow: false } } : {}),
  };
}

const OUTCOME: Record<string, string> = {
  withdrawn: "This submission was withdrawn.",
  desk_rejected: "This submission was desk rejected.",
  rejected: "This submission was rejected.",
  poster: "Accepted as a poster.",
  spotlight: "Accepted as a spotlight.",
  oral: "Accepted as an oral.",
};

function Findings() {
  return (
    <section className="iclr-finding" aria-label="What decides it">
      <h2>What decides it, and what doesn&apos;t</h2>
      <p>Three things people believe about ICLR decisions, tested on ICLR 2024–2026 (28,000 decided papers).</p>
      <h3>“A weak batch helps.” It doesn&apos;t.</h3>
      <p>Papers with exactly the same scores (say 4, 4, 6, 6), split by how strong their 10 nearest neighbours were:</p>
      <div className="iclr-ft">
        <div><small>2024</small><b>49.7% / 49.8%</b><span>accepted, strong / weak neighbours</span></div>
        <div><small>2025</small><b>47.0% / 49.9%</b><span>accepted, strong / weak neighbours</span></div>
        <div><small>2026</small><b>42.5% / 44.5%</b><span>accepted, strong / weak neighbours</span></div>
      </div>
      <h3>“Some areas are easier.” Barely, and not the same ones each year.</h3>
      <p>At equal scores, primary areas differ by 2 to 6 points, and the lenient ones change year to year (transfer learning was among the strictest in 2024 and the most lenient in 2025).</p>
      <h3>“Only the average matters.” No: agreement does.</h3>
      <div className="iclr-ft">
        <div><small>2024</small><b>87% / 63%</b><span>accepted, reviewers agree / split</span></div>
        <div><small>2025</small><b>61% / 36%</b><span>accepted, reviewers agree / split</span></div>
        <div><small>2026</small><b>43% / 36%</b><span>accepted, reviewers agree / split</span></div>
      </div>
      <p>Same total score, e.g. 4, 6, 6 versus 2, 6, 8.</p>
    </section>
  );
}

export default async function IclrPage({ searchParams }: Props) {
  const { id, q = "" } = await searchParams;
  const query = q.trim();
  const pasted = query ? openreviewId(query) : null;
  if (pasted && !id) redirect(`/iclr?id=${pasted}`);

  const stats = await iclrStats();
  if (!stats) {
    return (
      <main className="wrap page iclr">
        <h1 className="page-title">ICLR {ICLR_YEAR}: where does your paper stand?</h1>
        <p className="empty">The ICLR data isn&apos;t loaded yet. Check back soon.</p>
      </main>
    );
  }
  const s = stats.data;
  const paper = id ? await iclrPaper(id) : null;
  if (id && !paper) notFound();
  const pool = paper ? await iclrPool(paper.neighbors) : [];
  const results = !paper && query ? await iclrSearch(query) : [];
  const updated = new Date(stats.updated_at).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <main className="wrap page iclr">
      {!paper && (
        <>
          <h1 className="page-title">ICLR {ICLR_YEAR}: where does your paper stand?</h1>
          <p className="iclr-lede">
            {s.counts.submitted.toLocaleString("en-US")} submissions, {s.counts.withdrawn.toLocaleString("en-US")} already withdrawn.
            Public review scores from OpenReview via <a href="https://papercopilot.com" target="_blank" rel="noopener noreferrer">Paper Copilot</a>, updated daily (last {updated}).
          </p>
        </>
      )}
      {paper && <p className="iclr-crumb"><Link href="/iclr">← All ICLR {ICLR_YEAR} submissions</Link></p>}

      <form className="iclr-search" action="/iclr">
        <input name="q" defaultValue={paper ? "" : query} placeholder="Paste a paper's title or OpenReview link" aria-label="Find a submission" />
        <button type="submit">Find</button>
      </form>

      {query && !paper && (
        results.length ? (
          <ul className="iclr-results">
            {results.map((r) => (
              <li key={r.id}>
                <Link href={`/iclr?id=${r.id}`}>{r.title}</Link>
                <span>{r.outcome === "pending" ? r.ratings.join(" · ") || "No reviews yet" : r.outcome.replace("_", " ")}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">No ICLR {ICLR_YEAR} submission matches that. Try a few exact words from the title, or paste its OpenReview link.</p>
        )
      )}

      {paper ? (
        paper.outcome !== "pending" || paper.ratings.length < 3 ? (
          <section className="iclr-card">
            <h1 className="iclr-title">{paper.title}</h1>
            <p className="empty">{OUTCOME[paper.outcome] ?? "This submission doesn't have three reviews yet, so there's nothing to rank."}</p>
          </section>
        ) : (
          <IclrStanding stats={s} title={paper.title} area={paper.area} ratings={paper.ratings} confidences={paper.confidences}
            pool={pool} similarLast={paper.similar_last} />
        )
      ) : (
        !query && (
          <section className="iclr-card" aria-label="All submissions">
            <div className="iclr-bh">
              <h2>All submissions</h2>
              <p>Mean review score of {s.counts.reviewed.toLocaleString("en-US")} submissions with 3+ reviews ({s.scale[0]}–{s.scale[1]} scale)</p>
            </div>
            <IclrDistribution stats={s} />
          </section>
        )
      )}

      <Findings />
      <p className="iclr-note">
        How the chance is computed: the paper&apos;s rank among this year&apos;s submissions (mean, lowest and highest score, and how much
        reviewers disagree), calibrated on ICLR 2024–2026 decisions. Ranks, not raw scores, because the scale changes almost every year
        ({ICLR_YEAR} uses {s.scale[0]}–{s.scale[1]}). Held out one year at a time it ranks papers well (AUC 0.89–0.95), but any single year
        can run 5–10 points above or below, and it was fitted on final scores while these are still before the rebuttal. Similar papers are
        found with SPECTER2. Not affiliated with ICLR or OpenReview.
      </p>
    </main>
  );
}
