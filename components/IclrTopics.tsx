"use client";

// Competition by topic on /iclr: primary areas, author keywords (searchable) and a scatter of
// keyword batch strength against expected acceptance. Data from scripts/iclr_topics.py.
import { Fragment, useMemo, useState } from "react";
import type { IclrTopic, IclrTopics as Topics } from "@/lib/iclr";
import { ICLR_COPY, type Lang } from "@/lib/iclrCopy";

type Col = "key" | "n" | "growth" | "mean" | "expected" | "lastRate" | "batch" | "left";
const pc = (x?: number | null, d = 0) => (x == null ? "–" : `${(x * 100).toFixed(d)}%`);
const shortArea = (a: string) => a.replace(/\s*\(.*$/, "").replace(/,\s*(and|including).*$/i, "").replace(/^applications to /, "");

function Table({ rows, cols, t, lang, onPick, limit }: {
  rows: IclrTopic[]; cols: Col[]; t: (typeof ICLR_COPY)["en"]; lang: Lang; onPick?: (k: string) => void; limit?: number;
}) {
  const [sort, setSort] = useState<{ col: Col; desc: boolean }>({ col: "n", desc: true });
  const val = (r: IclrTopic, c: Col): number | string => {
    if (c === "key") return r.key;
    if (c === "growth") return r.lastN ? r.n / r.lastN : -1;
    return (r[c] as number | undefined) ?? -1;
  };
  const sorted = [...rows].sort((a, b) => {
    const x = val(a, sort.col), y = val(b, sort.col);
    const d = typeof x === "string" ? x.localeCompare(y as string) : x - (y as number);
    return sort.desc ? -d : d;
  });
  const shown = limit ? sorted.slice(0, limit) : sorted;
  const head = (c: Col) => (
    <th key={c} scope="col" aria-sort={sort.col === c ? (sort.desc ? "descending" : "ascending") : undefined}>
      <button type="button" onClick={() => setSort({ col: c, desc: sort.col === c ? !sort.desc : c !== "key" })}>
        {t.topicCols[c]}{sort.col === c ? (sort.desc ? " ↓" : " ↑") : ""}
      </button>
    </th>
  );
  const cell = (r: IclrTopic, c: Col) => {
    switch (c) {
      case "key": return <th scope="row">{onPick ? <button type="button" className="iclr-kw" onClick={() => onPick(r.key)}>{r.key}</button> : shortArea(r.key)}</th>;
      case "n": return <td>{r.n.toLocaleString("en-US")}</td>;
      case "growth": return <td>{r.lastN ? `×${(r.n / r.lastN).toFixed(1)}` : "–"}</td>;
      case "mean": return <td>{r.mean?.toFixed(2) ?? "–"}</td>;
      case "expected": return <td><b className="iclr-exp" style={{ ["--w" as string]: `${Math.min(100, r.expected * 200)}%` }}>{pc(r.expected, 1)}</b></td>;
      case "lastRate": return <td>{pc(r.lastRate)}</td>;
      case "batch": return <td>{r.batch?.toFixed(2) ?? "–"}</td>;
      case "left": return <td>{pc(r.left)}</td>;
    }
  };
  return (
    <div className="iclr-tablewrap">
      <table className="iclr-table" lang={lang === "zh" ? "en" : undefined}>
        <thead><tr>{cols.map(head)}</tr></thead>
        <tbody>{shown.map((r) => <tr key={r.key}>{cols.map((c) => <Fragment key={c}>{cell(r, c)}</Fragment>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function Scatter({ rows, hit, onPick, t }: { rows: IclrTopic[]; hit: Set<string>; onPick: (k: string) => void; t: (typeof ICLR_COPY)["en"] }) {
  const pts = rows.filter((r) => r.batch != null);
  const [hover, setHover] = useState<IclrTopic | null>(null);
  if (pts.length < 10) return null;
  const W = 900, H = 420, L = 54, B = 44, T = 14, R = 14;
  const xs = pts.map((r) => r.batch as number), ys = pts.map((r) => r.expected);
  const [x0, x1] = [Math.min(...xs) - 0.02, Math.max(...xs) + 0.02];
  const [y0, y1] = [0, Math.min(1, Math.max(...ys) + 0.05)];
  const x = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R);
  const y = (v: number) => H - B - ((v - y0) / (y1 - y0)) * (H - B - T);
  const r = (n: number) => 2.5 + Math.sqrt(n) / 6;
  const yt = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6].filter((v) => v <= y1);
  const xt: number[] = [];
  for (let v = Math.ceil(x0 * 10) / 10; v <= x1; v += 0.1) xt.push(Math.round(v * 10) / 10);
  const lit = hit.size > 0;
  return (
    <figure className="iclr-scatter">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={t.scatterTitle}>
        {yt.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="iclr-grid" /><text x={L - 8} y={y(v) + 4} textAnchor="end">{v * 100}%</text></g>)}
        {xt.map((v) => <text key={v} x={x(v)} y={H - B + 18} textAnchor="middle">{v.toFixed(1)}</text>)}
        <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" className="iclr-axis">{t.scatterX}</text>
        <text x={14} y={(T + H - B) / 2} textAnchor="middle" transform={`rotate(-90 14 ${(T + H - B) / 2})`} className="iclr-axis">{t.scatterY}</text>
        {pts.map((p) => (
          <circle key={p.key} cx={x(p.batch as number)} cy={y(p.expected)} r={r(p.n)}
            className={`iclr-dot${lit ? (hit.has(p.key) ? " is-hit" : " is-dim") : ""}${hover?.key === p.key ? " is-hover" : ""}`}
            onMouseEnter={() => setHover(p)} onMouseLeave={() => setHover(null)} onClick={() => onPick(p.key)}>
            <title>{p.key}</title>
          </circle>
        ))}
        {hover && (
          <g pointerEvents="none">
            <rect x={Math.min(x(hover.batch as number) + 10, W - 250)} y={Math.max(4, y(hover.expected) - 44)} width={240} height={40} rx={8} className="iclr-tip" />
            <text x={Math.min(x(hover.batch as number) + 20, W - 240)} y={Math.max(4, y(hover.expected) - 44) + 17} className="iclr-tipt">{hover.key.slice(0, 34)}</text>
            <text x={Math.min(x(hover.batch as number) + 20, W - 240)} y={Math.max(4, y(hover.expected) - 44) + 33} className="iclr-tips">
              {hover.n} · {pc(hover.expected, 1)} · {t.topicCols.batch} {hover.batch?.toFixed(2)}
            </text>
          </g>
        )}
      </svg>
      <figcaption>{t.scatterNote}</figcaption>
    </figure>
  );
}

export function IclrTopics({ data, lang = "en" }: { data: Topics; lang?: Lang }) {
  const t = ICLR_COPY[lang];
  const [tab, setTab] = useState<"areas" | "keywords">("keywords");
  const [q, setQ] = useState("");
  const [all, setAll] = useState(false);
  const words = q.trim().toLowerCase();
  const matches = useMemo(() => (words ? data.keywords.filter((k) => k.key.includes(words)) : data.keywords), [data.keywords, words]);
  const hit = useMemo(() => new Set(words ? matches.map((m) => m.key) : []), [matches, words]);
  const pick = (k: string) => { setTab("keywords"); setQ(k); };
  return (
    <section className="iclr-card" aria-label={t.topicsTitle}>
      <div className="iclr-bh">
        <h2>{t.topicsTitle}</h2>
        <p>{t.topicsNote(data.keywords.length)}</p>
      </div>
      <div className="iclr-controls">
        <div className="iclr-seg" role="group" aria-label={t.topicsTitle}>
          <button type="button" aria-pressed={tab === "keywords"} onClick={() => setTab("keywords")}>{t.tabKeywords}</button>
          <button type="button" aria-pressed={tab === "areas"} onClick={() => setTab("areas")}>{t.tabAreas}</button>
        </div>
        {tab === "keywords" && (
          <input className="iclr-kwsearch" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t.kwPlaceholder} aria-label={t.kwPlaceholder} />
        )}
      </div>
      {tab === "areas" ? (
        <Table rows={data.areas} cols={["key", "n", "growth", "left", "mean", "expected", "lastRate"]} t={t} lang={lang} />
      ) : (
        <>
          <Scatter rows={data.keywords} hit={hit} onPick={pick} t={t} />
          {words && !matches.length && <p className="empty">{t.kwNone}</p>}
          <Table rows={matches} cols={["key", "n", "left", "mean", "expected", "batch"]} t={t} lang={lang} onPick={pick} limit={all || words ? undefined : 25} />
          {!words && !all && matches.length > 25 && (
            <button type="button" className="iclr-more" onClick={() => setAll(true)}>{t.kwAll(matches.length)}</button>
          )}
        </>
      )}
      <p className="iclr-note">{t.topicsFoot}</p>
    </section>
  );
}
