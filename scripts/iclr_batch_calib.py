"""Calibrates the page's batch-quota chance on past years.

For each decided paper of ICLR 2024-2026 (3+ reviews), simulate the page's batches: 15 drawn from
its 50 nearest decided submissions in the same primary area (SPECTER2, closer ones likelier,
weight exp(-rank/25)), and count
how often it makes a quota equal to that year's acceptance share. Then fit actual outcome against that
raw share (Platt, on the logit), leave-one-year-out, and write the fit into scripts/iclr-model.json.
    worker/.venv-embed/bin/python scripts/iclr_batch_calib.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ACC = {"oral", "spotlight", "poster"}
POOL, K, DRAWS = 50, 15, 300
EPS = 0.005


def year(y: int, rng: np.random.Generator) -> tuple[np.ndarray, np.ndarray]:
    rows = [r for r in json.loads((DATA / f"iclr-{y}.json").read_text()) if r["outcome"] in ACC | {"rejected"} and len(r["reviews"]) >= 3]
    vec = np.load(DATA / f"iclr-{y}-decided-emb.npy").astype(np.float32)
    mean = np.array([np.mean([x["rating"] for x in r["reviews"]]) for r in rows])
    acc = np.array([r["outcome"] in ACC for r in rows])
    area = np.array([r["area"] or "" for r in rows])
    q = acc.mean()
    slots = q * (K + 1)
    logw = -np.arange(POOL) / 25
    out = np.zeros(len(rows))
    for s in range(0, len(rows), 1000):
        sim = vec[s:s + 1000] @ vec.T
        sim[np.arange(len(sim)), np.arange(s, s + len(sim))] = -9
        sim -= 4 * (area[None, :] != area[s:s + len(sim), None])  # batches stay inside a primary area
        part = np.argpartition(-sim, POOL, axis=1)[:, :POOL]
        nb = np.take_along_axis(part, np.argsort(-np.take_along_axis(sim, part, 1), 1), 1)  # closest first
        m_nb = mean[nb]                                   # (n, POOL)
        me = mean[s:s + len(nb)][:, None]
        ahead = (m_nb > me + 1e-9) + 0.5 * (np.abs(m_nb - me) < 1e-9)  # 1, 0.5 (tie) or 0
        # weighted draws without replacement: Gumbel top-k on log weights
        g = logw[None, None, :] - np.log(-np.log(rng.random((len(nb), DRAWS, POOL))))
        pick = np.argsort(-g, axis=2)[:, :, :K]
        rank = 1 + np.take_along_axis(np.broadcast_to(ahead[:, None, :], pick.shape[:2] + (POOL,)), pick, 2).sum(2)
        out[s:s + len(nb)] = (rank <= slots).mean(1)
    print(f"ICLR {y}: {len(rows)} papers, quota {q:.0%} of {K + 1}", flush=True)
    return out, acc


def logit(p: np.ndarray) -> np.ndarray:
    p = np.clip(p, EPS, 1 - EPS)
    return np.log(p / (1 - p))


def main() -> None:
    rng = np.random.default_rng(0)
    data = {y: year(y, rng) for y in (2024, 2025, 2026)}
    for y in data:
        raw, acc = data[y]
        tr = [o for o in data if o != y]
        m = LogisticRegression(C=1e6).fit(np.concatenate([logit(data[o][0]) for o in tr])[:, None], np.concatenate([data[o][1] for o in tr]))
        p = m.predict_proba(logit(raw)[:, None])[:, 1]
        bins = np.quantile(raw, [0, .2, .4, .6, .8, 1])
        cal = " | ".join(f"raw {raw[(raw >= a) & (raw <= b)].mean():.0%}->{acc[(raw >= a) & (raw <= b)].mean():.0%}" for a, b in zip(bins[:-1], bins[1:]))
        print(f"  held-out {y}: raw AUC {roc_auc_score(acc, raw):.4f}, calibrated logloss {log_loss(acc, p):.4f}  ({cal})")
    m = LogisticRegression(C=1e6).fit(np.concatenate([logit(d[0]) for d in data.values()])[:, None], np.concatenate([d[1] for d in data.values()]))
    a, b = float(m.coef_[0, 0]), float(m.intercept_[0])
    f = HERE / "iclr-model.json"
    model = json.loads(f.read_text())
    # keep a level shift fitted on the year in review (its calibrated mean against its quota)
    shift = (model.get("batchCalib") or {}).get("shift", 0)
    model["batchCalib"] = {"a": round(a, 4), "b": round(b, 4), "eps": EPS, "shift": shift, "draws": "15 of the 50 nearest in the same primary area, weight exp(-rank/25)"}
    f.write_text(json.dumps(model))
    print(f"calibrated batch chance = sigmoid({a:.3f} * logit(raw) {b:+.3f}); wrote {f.name}")


if __name__ == "__main__":
    main()
