"""Does a paper's rank among similar submissions (a simulated AC batch) predict ICLR acceptance
better than its scores alone?

Reads scripts/data/iclr-<year>.json (scripts/iclr_fetch.py), embeds title + abstract with
SPECTER2 (cached next to the data), and for each year builds simulated AC batches two ways:
  knn:    each paper's k nearest submissions of the same year
  kmeans: submissions split into clusters of about k papers (each paper in one batch, like a real AC)
Then fits logistic regression on earlier years and tests on a later one, with and without batch
features, against a "primary area" baseline (what topic-level ranking sites do).
    worker/.venv-embed/bin/python scripts/iclr_backtest.py
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from sklearn.cluster import KMeans
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import brier_score_loss, log_loss, roc_auc_score
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

DATA = Path(__file__).resolve().parent / "data"
ACCEPT = {"oral", "spotlight", "poster"}
DECIDED = ACCEPT | {"rejected"}
KS = [5, 10, 15, 25, 50]


def embed(rows: list[dict], path: Path) -> np.ndarray:
    if path.exists():
        v = np.load(path)
        if len(v) == len(rows):
            return v
    import torch
    from adapters import AutoAdapterModel
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained("allenai/specter2_base")
    model = AutoAdapterModel.from_pretrained("allenai/specter2_base")
    model.set_active_adapters(model.load_adapter("allenai/specter2", source="hf", load_as="proximity", set_active=True))
    model.eval()
    dev = "mps" if torch.backends.mps.is_available() else "cpu"
    model.to(dev)
    out = []
    for i in range(0, len(rows), 32):
        text = [(r["title"] or "") + tok.sep_token + (r["abstract"] or "") for r in rows[i:i + 32]]
        enc = tok(text, padding=True, truncation=True, max_length=512, return_tensors="pt", return_token_type_ids=False).to(dev)
        with torch.no_grad():
            out.append(model(**enc).last_hidden_state[:, 0, :].float().cpu().numpy())
        if i % 1600 == 0:
            print(f"  embedded {i}/{len(rows)}", flush=True)
    v = np.concatenate(out)
    v /= np.linalg.norm(v, axis=1, keepdims=True)
    np.save(path, v)
    return v


def review_stats(r: dict) -> list[float]:
    s = np.array([x["rating"] for x in r["reviews"]], float)
    c = np.array([x["confidence"] or 3 for x in r["reviews"]], float)
    return [s.mean(), s.std(), s.min(), s.max(), (s * c).sum() / c.sum(), len(s)]


def pct_within(mean: np.ndarray, groups: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
    """Percentile of each paper's mean rating in its batch (ties count half), and its gap to the batch mean."""
    pct, gap = np.zeros(len(mean)), np.zeros(len(mean))
    for i, g in enumerate(groups):
        other = mean[g[g != i]]
        if len(other) == 0:
            pct[i], gap[i] = 0.5, 0.0
            continue
        pct[i] = ((other < mean[i]).sum() + 0.5 * (other == mean[i]).sum()) / len(other)
        gap[i] = mean[i] - other.mean()
    return pct, gap


def year_features(year: int) -> dict | None:
    f = DATA / f"iclr-{year}.json"
    if not f.exists():
        return None
    rows = [r for r in json.loads(f.read_text()) if r["outcome"] in DECIDED and len(r["reviews"]) >= 3]
    if not rows:
        return None
    vec = embed(rows, DATA / f"iclr-{year}-decided-emb.npy")
    stats = np.array([review_stats(r) for r in rows])
    mean = stats[:, 0]
    y = np.array([r["outcome"] in ACCEPT for r in rows], int)
    vec = vec.astype(np.float32)
    top = max(KS)
    order = np.zeros((len(rows), top), int)
    for s in range(0, len(rows), 2000):
        sim = vec[s:s + 2000] @ vec.T
        sim[np.arange(len(sim)), np.arange(s, s + len(sim))] = -1
        part = np.argpartition(-sim, top, axis=1)[:, :top]
        order[s:s + len(sim)] = np.take_along_axis(part, np.argsort(-np.take_along_axis(sim, part, 1), 1), 1)
    feats = {"stats": stats}
    for k in KS:
        feats[f"knn{k}"] = np.column_stack(pct_within(mean, [order[i, :k] for i in range(len(rows))]))
        km = KMeans(n_clusters=max(2, len(rows) // k), n_init=1, random_state=0).fit(vec).labels_
        members = {c: np.where(km == c)[0] for c in np.unique(km)}
        feats[f"kmeans{k}"] = np.column_stack(pct_within(mean, [members[c] for c in km]))
    areas = [r["area"] or "?" for r in rows]
    by_area = {a: np.array([i for i, b in enumerate(areas) if b == a]) for a in set(areas)}
    feats["area"] = np.column_stack(pct_within(mean, [by_area[a] for a in areas]))
    feats["global"] = np.column_stack(pct_within(mean, [np.arange(len(rows))] * len(rows)))
    print(f"ICLR {year}: {len(rows)} decided papers with 3+ reviews, accept rate {y.mean():.1%}", flush=True)
    return {"y": y, "mean": mean, "feats": feats, "rows": rows}


def X(d: dict, extra: list[str]) -> np.ndarray:
    return np.column_stack([d["feats"]["stats"]] + [d["feats"][e] for e in extra])


def evaluate(train: list[dict], test: dict, extra: list[str]) -> dict:
    m = make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000, C=1.0))
    m.fit(np.vstack([X(d, extra) for d in train]), np.concatenate([d["y"] for d in train]))
    p = m.predict_proba(X(test, extra))[:, 1]
    return {"auc": roc_auc_score(test["y"], p), "logloss": log_loss(test["y"], p), "brier": brier_score_loss(test["y"], p), "p": p}


def borderline_table(d: dict, key: str) -> None:
    """Accept rate by batch percentile, among papers with similar mean ratings."""
    pct = d["feats"][key][:, 0]
    for lo, hi in [(4.5, 5.25), (5.25, 5.75), (5.75, 6.25), (6.25, 7.0)]:
        sel = (d["mean"] >= lo) & (d["mean"] < hi)
        if sel.sum() < 60:
            continue
        cuts = np.quantile(pct[sel], [1 / 3, 2 / 3])
        parts = [sel & (pct < cuts[0]), sel & (pct >= cuts[0]) & (pct < cuts[1]), sel & (pct >= cuts[1])]
        rates = " | ".join(f"{d['y'][s].mean():5.1%} (n={s.sum()})" for s in parts)
        print(f"    mean {lo:.2f}-{hi:.2f}: bottom/middle/top third of batch -> {rates}")


def main() -> None:
    years = [int(y) for y in sys.argv[1:]] or [2024, 2025, 2026]
    data = {y: d for y in years if (d := year_features(y))}
    if len(data) < 2:
        raise SystemExit("Need at least two years of decided data (run scripts/iclr_fetch.py).")
    ys = sorted(data)
    setups = [("scores only", []), ("+ global rank", ["global"]), ("+ primary-area rank", ["area"])]
    setups += [(f"+ knn batch k={k}", [f"knn{k}"]) for k in KS]
    setups += [(f"+ kmeans batch ~{k}", [f"kmeans{k}"]) for k in KS]
    setups += [("+ area + knn15 + kmeans15", ["area", "knn15", "kmeans15"])]
    for i in range(1, len(ys)):
        test, train = data[ys[i]], [data[y] for y in ys[:i]]
        print(f"\nTrain {ys[:i]} -> test {ys[i]}  (n={len(test['y'])})")
        base = None
        for name, extra in setups:
            r = evaluate(train, test, extra)
            base = base or r
            print(f"  {name:28s} AUC {r['auc']:.4f} ({r['auc'] - base['auc']:+.4f})  logloss {r['logloss']:.4f}  brier {r['brier']:.4f}")
    for y in ys:
        print(f"\nICLR {y}: does batch rank matter at the same mean rating? (knn k=15)")
        borderline_table(data[y], "knn15")
        print(f"ICLR {y}: same, primary-area rank")
        borderline_table(data[y], "area")


if __name__ == "__main__":
    main()
