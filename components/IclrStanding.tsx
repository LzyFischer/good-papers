"use client";

// The interactive parts of /iclr: the score distribution, the chance of acceptance with a
// what-if for each review, last year's outcomes at the same rank, and simulated AC batches.
// Everything is computed here from the year's lookup tables (lib/iclr.ts, scripts/iclr_sync.py).
import { useMemo, useState } from "react";
import type { IclrNeighbor, IclrStats } from "@/lib/iclr";

type Table = { xs: number[]; below: number[]; at: number[]; n: number };
function table(pairs: [number, number][]): Table {
  let n = 0;
  const xs: number[] = [], below: number[] = [], at: number[] = [];
  for (const [v, c] of pairs) { xs.push(v); below.push(n); at.push(c); n += c; }
  return { xs, below, at, n };
}
/** Share of the year's submissions below v, ties counted half (as in scripts/iclr_model.py). */
function pct(t: Table, v: number) {
  let lo = 0, hi = t.xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t.xs[m] < v - 1e-9) lo = m + 1; else hi = m; }
  const exact = lo < t.xs.length && Math.abs(t.xs[lo] - v) < 1e-6;
  return ((lo < t.xs.length ? t.below[lo] : t.n) + (exact ? t.at[lo] / 2 : 0)) / t.n;
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const fmt = (p: number) => (p < 0.01 ? "<1%" : p > 0.99 ? ">99%" : `${Math.round(p * 100)}%`);

function useModel(stats: IclrStats) {
  return useMemo(() => {
    const ref = { mean: table(stats.ref.mean), min: table(stats.ref.min), max: table(stats.ref.max) };
    return (r: number[]) => {
      const pm = pct(ref.mean, mean(r));
      const f = [pm, pct(ref.min, Math.min(...r)), pct(ref.max, Math.max(...r)), std(r) / stats.sdMean, pm * pm, pm ** 3];
      const z = stats.model.intercept + f.reduce((s, x, i) => s + x * stats.model.coef[i], 0);
      return { p: 1 / (1 + Math.exp(-z)), pm };
    };
  }, [stats]);
}

export function IclrDistribution({ stats, at }: { stats: IclrStats; at?: number }) {
  const W = 900, H = 190, pad = 28, [lo, hi] = stats.scale;
  const maxC = Math.max(...stats.hist.map((b) => b[1]));
  const x = (v: number) => pad + ((v - lo) / (hi - lo)) * (W - 2 * pad);
  const y = (c: number) => H - 28 - (c / maxC) * (H - 50);
  const path = (pts: [number, number][]) => pts.map(([v, c], i) => `${i ? "L" : "M"}${x(v).toFixed(1)},${y(c).toFixed(1)}`).join("");
  const line = path(stats.hist);
  const left = at === undefined ? [] : stats.hist.filter(([v]) => v <= at);
  const ticks: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += (hi - lo) / 6) ticks.push(Math.round(v * 100) / 100);
  return (
    <svg className="iclr-dist" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Distribution of mean review scores">
      <path d={`${line}L${x(hi)},${H - 28}L${x(lo)},${H - 28}Z`} className="iclr-dist-all" />
      {at !== undefined && left.length > 0 && <path d={`${path(left)}L${x(at)},${H - 28}L${x(lo)},${H - 28}Z`} className="iclr-dist-below" />}
      <path d={line} className="iclr-dist-line" />
      {ticks.map((v) => <text key={v} x={x(v)} y={H - 8} textAnchor="middle">{v}</text>)}
      {at !== undefined && (
        <g>
          <line x1={x(at)} x2={x(at)} y1={16} y2={H - 28} className="iclr-dist-you" />
          <rect x={x(at) - 36} y={0} width={72} height={19} rx={9.5} className="iclr-dist-tag" />
          <text x={x(at)} y={13.5} textAnchor="middle" className="iclr-dist-tagtext">You {at.toFixed(2)}</text>
        </g>
      )}
    </svg>
  );
}

const Chip = ({ r, cls = "" }: { r: number; cls?: string }) => <i className={`iclr-chip iclr-chip--${Math.round(r)} ${cls}`}>{r}</i>;

/** Seeded so the server and the browser draw the same batch (no hydration mismatch). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Weighted draw without replacement from the pool (closest first): the 1st is ~7x likelier than the 50th. */
function draw(n: number, k: number, random: () => number) {
  const left = Array.from({ length: n }, (_, i) => i), out: number[] = [];
  while (out.length < Math.min(k, n)) {
    const w = left.map((i) => Math.exp(-i / 25)), tot = w.reduce((a, b) => a + b, 0);
    let r = random() * tot, j = 0;
    while ((r -= w[j]) > 0 && j < w.length - 1) j++;
    out.push(left.splice(j, 1)[0]);
  }
  return out;
}

export function IclrStanding({ stats, title, area, ratings: real, confidences, pool, similarLast }: {
  stats: IclrStats; title: string; area: string | null; ratings: number[]; confidences: number[];
  pool: IclrNeighbor[]; similarLast: { title: string; outcome: string; ratings: number[] }[];
}) {
  const chance = useModel(stats);
  const [ratings, setRatings] = useState(real);
  const [size, setSize] = useState(15);
  const [seed, setSeed] = useState(0);
  const [lo, hi] = stats.scale;
  const step = hi - lo > 4 ? 2 : 1;
  const orig = chance(real).p;
  const { p, pm } = chance(ratings);
  const m = mean(ratings);
  const changed = ratings.some((r, i) => r !== real[i]);
  const means = useMemo(() => pool.map((q) => mean(q.ratings)), [pool]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const batch = useMemo(() => draw(pool.length, size, rng(seed * 7919 + size)), [pool.length, size, seed]);
  const rankIn = (ids: number[]) => 1 + ids.filter((i) => means[i] > m + 1e-9).length + ids.filter((i) => Math.abs(means[i] - m) < 1e-9).length / 2;
  const summary = useMemo(() => {
    if (pool.length < size) return null;
    const ranks: number[] = [], random = rng(20270);
    for (let t = 0; t < 1000; t++) ranks.push(rankIn(draw(pool.length, size, random)));
    ranks.sort((a, b) => a - b);
    return { med: ranks[500], topThird: ranks.filter((r) => r <= (size + 1) / 3).length / 1000, lo: ranks[100], hi: ranks[900] };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool.length, size, m, means]);

  // last year's papers at this rank: widen the window until it holds 200+
  const last = useMemo(() => {
    if (!stats.lastBins) return null;
    const c = Math.min(99, Math.floor(pm * 100));
    let w = 1, a = 0, b = 0, t = [0, 0, 0];
    do {
      a = Math.max(0, c - w); b = Math.min(99, c + w); t = [0, 0, 0];
      for (let k = a; k <= b; k++) stats.lastBins[k].forEach((v, j) => (t[j] += v));
      w++;
    } while (t[0] + t[1] + t[2] < 200 && w < 50);
    return { a, b, t, n: t[0] + t[1] + t[2] };
  }, [stats.lastBins, pm]);

  const rows = batch
    .map((i) => ({ ...pool[i], mean: means[i], me: false }))
    .concat([{ id: "me", title, ratings: [...ratings].sort((x, y) => y - x), mean: m, me: true }])
    .sort((x, y) => y.mean - x.mean || (x.me ? -1 : 1));
  const tone = p >= 0.6 ? "good" : p >= 0.3 ? "mid" : "low";

  return (
    <>
      <section className="iclr-card" aria-label="All submissions">
        <div className="iclr-bh">
          <h2>All submissions</h2>
          <p>Mean review score of {stats.counts.reviewed.toLocaleString("en-US")} submissions with 3+ reviews ({lo}–{hi} scale). This paper is ahead of {Math.round(pm * 100)}%.</p>
        </div>
        <IclrDistribution stats={stats} at={m} />
      </section>

      <section className="iclr-card" aria-label="Chance of acceptance">
        <div className="iclr-head">
          <div className={`iclr-ring iclr-ring--${tone}`} style={{ ["--p" as string]: `${p * 100}%` }}>
            <div><b>{fmt(p)}</b><small>chance of<br />acceptance</small></div>
          </div>
          <div>
            {area && <p className="iclr-area">{area}</p>}
            <h1 className="iclr-title">{title}</h1>
            <div className="iclr-facts">
              <span><b>{m.toFixed(2)}</b>mean score</span>
              <span><b>Top {Math.max(1, Math.round((1 - pm) * 100))}%</b>of submissions</span>
              {changed && <span><b>{p >= orig ? "+" : "−"}{Math.abs(Math.round((p - orig) * 100))} pts</b>vs the real scores ({fmt(orig)})</span>}
            </div>
          </div>
        </div>

        <div className="iclr-bh iclr-sub">
          <h2>What if a reviewer changes their score?</h2>
          <p>Tap + or − on a review. Everything on this page updates.</p>
        </div>
        <div className="iclr-sim">
          {ratings.map((r, i) => (
            <div key={i} className={`iclr-rev${r !== real[i] ? " is-changed" : ""}`}>
              <button type="button" aria-label={`Raise review ${i + 1}`} disabled={r >= hi}
                onClick={() => setRatings(ratings.map((v, j) => (j === i ? Math.min(hi, v + step) : v)))}>+</button>
              <Chip r={r} />
              <button type="button" aria-label={`Lower review ${i + 1}`} disabled={r <= lo}
                onClick={() => setRatings(ratings.map((v, j) => (j === i ? Math.max(lo, v - step) : v)))}>−</button>
              <small>R{i + 1}{confidences[i] ? ` · conf ${confidences[i]}` : ""}</small>
            </div>
          ))}
          {changed && <button type="button" className="iclr-reset" onClick={() => setRatings(real)}>Back to real scores</button>}
        </div>
        {std(ratings) > stats.spreadP75 && (
          <p className="iclr-warn">
            <b>These reviewers disagree</b> more than for 3 in 4 submissions. At the same total score, split papers were
            accepted less often in each of the last three years (36% vs 61% in 2025). The chance above accounts for it.
          </p>
        )}

        {last && last.n > 0 && (
          <>
            <div className="iclr-bh iclr-sub">
              <h2>Papers ranked like this one last year</h2>
              <p>ICLR {"2026"} submissions ranked between {last.a}% and {last.b + 1}% from the bottom ({last.n.toLocaleString("en-US")} papers)</p>
            </div>
            <div className="iclr-split">
              {(["Accepted", "Rejected", "Withdrew"] as const).map((k, j) => (
                <div key={k}><b>{Math.round((last.t[j] / last.n) * 100)}%</b><span>{k}</span></div>
              ))}
            </div>
          </>
        )}
      </section>

      {pool.length >= 10 && (
        <section className="iclr-card" aria-label="Simulated AC batch">
          <div className="iclr-bh">
            <h2>Simulated AC batch</h2>
            <p>An area chair gets a stack of submissions close to their own work. We can&apos;t see the real stacks, so we draw them from the {pool.length} submissions closest to this one in content.</p>
          </div>
          <div className="iclr-controls">
            <span>Batch size</span>
            <div className="iclr-seg" role="group" aria-label="Batch size">
              {[10, 15, 25].filter((k) => k <= pool.length).map((k) => (
                <button key={k} type="button" aria-pressed={k === size} onClick={() => setSize(k)}>{k}</button>
              ))}
            </div>
            <button type="button" className="iclr-shuffle" onClick={() => setSeed(seed + 1)}>↻ Shuffle batch</button>
          </div>
          {summary && (
            <div className="iclr-sum">
              <div><b>{Math.round(summary.med)} of {size + 1}</b><span>typical rank in 1,000 simulated batches</span></div>
              <div><b>{Math.round(summary.topThird * 100)}%</b><span>of batches with this paper in the top third</span></div>
              <div><b>{Math.round(summary.lo)}–{Math.round(summary.hi)}</b><span>rank range in 8 of 10 batches</span></div>
            </div>
          )}
          <ol className="iclr-list">
            {rows.map((q, i) => (
              <li key={q.id} className={q.me ? "is-me" : undefined}>
                <span className="iclr-rk">{i + 1}</span>
                <span className="iclr-t">
                  {q.me ? q.title : <a href={`/iclr?id=${q.id}`}>{q.title}</a>}
                  {q.me && <b className="iclr-you">This paper</b>}
                </span>
                <span className="iclr-chips">{q.ratings.map((r, j) => <Chip key={j} r={r} />)}</span>
                <span className="iclr-mn">{q.mean.toFixed(2)}</span>
                <span className="iclr-bar"><s style={{ width: `${((q.mean - lo) / (hi - lo)) * 100}%` }} /></span>
              </li>
            ))}
          </ol>
          <p className="iclr-note">This shows who the paper is up against in its niche. It does not change the chance above: we checked, and a weaker batch doesn&apos;t help (see below).</p>
        </section>
      )}

      {similarLast.length > 0 && (
        <section className="iclr-card" aria-label="Closest accepted papers last year">
          <div className="iclr-bh">
            <h2>Closest accepted papers from ICLR 2026</h2>
            <p>What got in last year in this corner (scores on last year&apos;s 0–10 scale)</p>
          </div>
          <ol className="iclr-list iclr-list--last">
            {similarLast.map((q) => (
              <li key={q.title}>
                <span className="iclr-t">{q.title}</span>
                <span className="iclr-chips">{q.ratings.map((r, j) => <i key={j} className="iclr-chip">{r}</i>)}</span>
                <span className="iclr-pill">{q.outcome[0].toUpperCase() + q.outcome.slice(1)}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
