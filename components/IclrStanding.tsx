"use client";

// The interactive parts of /iclr: the score distribution, the chance of acceptance with a
// what-if for each review, last year's outcomes at the same rank, and simulated AC batches.
// Everything is computed here from the year's lookup tables (lib/iclr.ts, scripts/iclr_sync.py).
import { useMemo, useState } from "react";
import type { IclrNeighbor, IclrStats } from "@/lib/iclr";
import { ICLR_COPY, type Lang } from "@/lib/iclrCopy";

type Table = { xs: number[]; below: number[]; at: number[]; n: number };
function table(pairs: [number, number][]): Table {
  let n = 0;
  const xs: number[] = [], below: number[] = [], at: number[] = [];
  for (const [v, c] of pairs) { xs.push(v); below.push(n); at.push(c); n += c; }
  return { xs, below, at, n };
}
/** Share of the year's submissions below v, ties counted half (as in scripts/iclr_model.py). */
/** [share strictly above v, share above or tied with v] */
function aboveRange(t: Table, v: number): [number, number] {
  let lo = 0, hi = t.xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t.xs[m] < v - 1e-9) lo = m + 1; else hi = m; }
  const exact = lo < t.xs.length && Math.abs(t.xs[lo] - v) < 1e-6;
  const below = lo < t.xs.length ? t.below[lo] : t.n, tied = exact ? t.at[lo] : 0;
  return [(t.n - below - tied) / t.n, (t.n - below) / t.n];
}

function pct(t: Table, v: number) {
  let lo = 0, hi = t.xs.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t.xs[m] < v - 1e-9) lo = m + 1; else hi = m; }
  const exact = lo < t.xs.length && Math.abs(t.xs[lo] - v) < 1e-6;
  return ((lo < t.xs.length ? t.below[lo] : t.n) + (exact ? t.at[lo] / 2 : 0)) / t.n;
}
const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
const std = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };
const fmt = (p: number) => (p < 0.01 ? "<1%" : p > 0.99 ? ">99%" : `${Math.round(p * 100)}%`);

function useModel(stats: IclrStats, confidences: number[]) {
  return useMemo(() => {
    const ref = { mean: table(stats.ref.mean), min: table(stats.ref.min), max: table(stats.ref.max) };
    const [mu, sd] = stats.confScale ?? [0, 1];
    // mean z-scored confidence of the reviewers giving the lowest (highest) score; unknown counts as average
    const edge = (r: number[], e: number) => mean(r.flatMap((a, i) => (a === e ? [confidences[i] ? (confidences[i] - mu) / sd : 0] : [])));
    return (r: number[]) => {
      const pm = pct(ref.mean, Math.round(mean(r) * 1e4) / 1e4);
      const lo = Math.min(...r), hi = Math.max(...r);
      const f = [pm, pct(ref.min, lo), pct(ref.max, hi), std(r) / stats.sdMean, pm * pm, pm ** 3];
      if (stats.model.coef.length > 6) f.push(edge(r, lo), edge(r, hi));
      const z = stats.model.intercept + f.reduce((s, x, i) => s + x * stats.model.coef[i], 0);
      return { p: 1 / (1 + Math.exp(-z)), pm };
    };
  }, [stats, confidences]);
}

export function IclrDistribution({ stats, at, you = "You" }: { stats: IclrStats; at?: number; you?: string }) {
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
          <text x={x(at)} y={13.5} textAnchor="middle" className="iclr-dist-tagtext">{you} {at.toFixed(2)}</text>
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

export function IclrStanding({ lang = "en", stats, title, area, ratings: real, confidences, pool, similarLast }: {
  lang?: Lang; stats: IclrStats; title: string; area: string | null; ratings: number[]; confidences: number[];
  pool: IclrNeighbor[]; similarLast: { title: string; outcome: string; ratings: number[] }[];
}) {
  const t = ICLR_COPY[lang];
  const chance = useModel(stats, confidences);
  const [ratings, setRatings] = useState(real);
  const [size, setSize] = useState(15);
  const [seed, setSeed] = useState(0);
  const [lo, hi] = stats.scale;
  const step = hi - lo > 4 ? 2 : 1;
  const orig = chance(real).p;
  const { p, pm } = chance(ratings);
  const m = mean(ratings);
  const meanTable = useMemo(() => table(stats.ref.mean), [stats]);
  const ties = aboveRange(meanTable, Math.round(m * 1e4) / 1e4);
  const changed = ratings.some((r, i) => r !== real[i]);
  const means = useMemo(() => pool.map((q) => mean(q.ratings)), [pool]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const batch = useMemo(() => draw(pool.length, size, rng(seed * 7919 + size)), [pool.length, size, seed]);
  const rankIn = (ids: number[]) => 1 + ids.filter((i) => means[i] > m + 1e-9).length + ids.filter((i) => Math.abs(means[i] - m) < 1e-9).length / 2;
  const quota = Math.min(0.9, ((stats.model.targetShare ?? 0) * stats.counts.submitted) / Math.max(1, stats.counts.live) || 1 / 3);
  const summary = useMemo(() => {
    if (pool.length < size) return null;
    const ranks: number[] = [], random = rng(20270);
    for (let t = 0; t < 1000; t++) ranks.push(rankIn(draw(pool.length, size, random)));
    ranks.sort((a, b) => a - b);
    // if each AC accepted a fixed share of their batch: the share the year's target implies among papers in review
    const cut = quota * (size + 1);
    const c = stats.model.batchCalib;
    // soft quota (scripts/iclr_batch_calib.py): a draw counts 1 / (1 + e^((rank - cutoff) / tau)), so papers
    // well below the line still differ; then the fit from past years maps it to a chance
    const tau = c?.tau ?? 0;
    const raw = ranks.reduce((s, r) => s + (tau ? 1 / (1 + Math.exp((r - cut) / tau)) : r <= cut ? 1 : 0), 0) / 1000;
    const quotaChance = c ? (() => { const r = Math.min(1 - c.eps, Math.max(c.eps, raw)); return 1 / (1 + Math.exp(-(c.a * Math.log(r / (1 - r)) + c.b + (c.shift ?? 0)))); })() : raw;
    return { med: ranks[500], quota: quotaChance, lo: ranks[100], hi: ranks[900] };
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
      <section className="iclr-card" aria-label={t.allTitle}>
        <div className="iclr-bh">
          <h2>{t.allTitle}</h2>
          <p>{t.allNote(stats.counts.reviewed, lo, hi)}{lang === "zh" ? "。" : ". "}{t.ahead(Math.round((1 - ties[1]) * 100))}</p>
        </div>
        <IclrDistribution stats={stats} at={m} you={t.you} />
      </section>

      <section className="iclr-card" aria-label={t.chance.join(" ")}>
        <div className="iclr-head">
          <div className={`iclr-ring iclr-ring--${tone}`} style={{ ["--p" as string]: `${p * 100}%` }}>
            <div><b>{fmt(p)}</b><small>{t.chance[0]}<br />{t.chance[1]}</small></div>
          </div>
          <div>
            {area && <p className="iclr-area">{area}</p>}
            <h1 className="iclr-title">{title}</h1>
            <div className="iclr-facts">
              <span><b>{m.toFixed(2)}</b>{t.meanScore}</span>
              {/* counting every paper tied at this mean as ahead: the cautious figure */}
              <span><b>{t.top(Math.max(1, Math.round(ties[1] * 100)))}</b>{t.ofSubs}</span>
              {changed && <span><b>{t.pts(Math.round((p - orig) * 100))}</b>{t.vsReal(fmt(orig))}</span>}
            </div>
          </div>
        </div>

        <div className="iclr-bh iclr-sub">
          <h2>{t.whatIf}</h2>
          <p>{t.whatIfHint}</p>
        </div>
        <div className="iclr-sim">
          {ratings.map((r, i) => (
            <div key={i} className={`iclr-rev${r !== real[i] ? " is-changed" : ""}`}>
              <button type="button" aria-label={t.raise(i + 1)} disabled={r >= hi}
                onClick={() => setRatings(ratings.map((v, j) => (j === i ? Math.min(hi, v + step) : v)))}>+</button>
              <Chip r={r} />
              <button type="button" aria-label={t.lower(i + 1)} disabled={r <= lo}
                onClick={() => setRatings(ratings.map((v, j) => (j === i ? Math.max(lo, v - step) : v)))}>−</button>
              <small>R{i + 1}{confidences[i] ? ` · ${t.conf} ${confidences[i]}` : ""}</small>
            </div>
          ))}
          {changed && <button type="button" className="iclr-reset" onClick={() => setRatings(real)}>{t.reset}</button>}
        </div>
        {std(ratings) > stats.spreadP75 && (
          <p className="iclr-warn">
            <b>{t.warnB}</b>{t.warn}
          </p>
        )}

        {last && last.n > 0 && (
          <>
            <div className="iclr-bh iclr-sub">
              <h2>{t.lastTitle}</h2>
              <p>{t.lastNote(last.a, last.b + 1, last.n)}</p>
            </div>
            <div className="iclr-split">
              {t.split.map((k, j) => (
                <div key={k}><b>{Math.round((last.t[j] / last.n) * 100)}%</b><span>{k}</span></div>
              ))}
            </div>
          </>
        )}
      </section>

      {pool.length >= 10 && (
        <section className="iclr-card" aria-label={t.batchTitle}>
          <div className="iclr-bh">
            <h2>{t.batchTitle}</h2>
            <p>{t.batchNote(pool.length)}</p>
          </div>
          <div className="iclr-controls">
            <span>{t.batchSize}</span>
            <div className="iclr-seg" role="group" aria-label={t.batchSize}>
              {[10, 15, 25].filter((k) => k <= pool.length).map((k) => (
                <button key={k} type="button" aria-pressed={k === size} onClick={() => setSize(k)}>{k}</button>
              ))}
            </div>
            <button type="button" className="iclr-shuffle" onClick={() => setSeed(seed + 1)}>{t.shuffle}</button>
          </div>
          {summary && (
            <div className="iclr-sum">
              <div><b>{t.sumRank(Math.round(summary.med), size + 1)}</b><span>{t.sumRankNote}</span></div>
              <div><b>{fmt(summary.quota)}</b><span>{t.sumQuota(Math.round(quota * 100))}</span></div>
              <div><b>{Math.round(summary.lo)}–{Math.round(summary.hi)}</b><span>{t.sumRange}</span></div>
            </div>
          )}
          <ol className="iclr-list">
            {rows.map((q, i) => (
              <li key={q.id} className={q.me ? "is-me" : undefined}>
                <span className="iclr-rk">{i + 1}</span>
                <span className="iclr-t">
                  {q.me ? q.title : <a href={`/iclr?id=${q.id}${lang === "zh" ? "&lang=zh" : ""}`}>{q.title}</a>}
                  {q.me && <b className="iclr-you">{t.thisPaper}</b>}
                </span>
                <span className="iclr-chips">{q.ratings.map((r, j) => <Chip key={j} r={r} />)}</span>
                <span className="iclr-mn">{q.mean.toFixed(2)}</span>
                <span className="iclr-bar"><s style={{ width: `${((q.mean - lo) / (hi - lo)) * 100}%` }} /></span>
              </li>
            ))}
          </ol>
          <p className="iclr-note">{t.batchFoot}</p>
        </section>
      )}

      {similarLast.length > 0 && (
        <section className="iclr-card" aria-label={t.lastAccTitle}>
          <div className="iclr-bh">
            <h2>{t.lastAccTitle}</h2>
            <p>{t.lastAccNote}</p>
          </div>
          <ol className="iclr-list iclr-list--last">
            {similarLast.map((q) => (
              <li key={q.title}>
                <span className="iclr-t">{q.title}</span>
                <span className="iclr-chips">{q.ratings.map((r, j) => <i key={j} className="iclr-chip">{r}</i>)}</span>
                <span className="iclr-pill">{t.pill[q.outcome] ?? q.outcome}</span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </>
  );
}
