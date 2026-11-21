"""Acceptance model that carries over between ICLR years whose rating scales differ.

Features are within-year ranks of a paper's mean, lowest and highest rating among every
submission with 3+ reviews (withdrawn ones included, since a year still in review hasn't lost
its future withdrawals yet), plus the spread of its ratings in units of that year's spread, and
how confident its lowest- and highest-scoring reviewers were (z-scored within the year, since the
confidence scale changes too: 1-5 until 2026, 1-4 in 2027). Confidence adds little (AUC +0.0003 to
+0.0006 held out), but it points the same way every year.
Trained on decided papers. Prints a check on the latest year, then fits on all years and writes
scripts/iclr-model.json (coefficients; committed, read by scripts/iclr_sync.py).
    worker/.venv-embed/bin/python scripts/iclr_model.py
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import log_loss, roc_auc_score

DATA = Path(__file__).resolve().parent / "data"
ACC = {"oral", "spotlight", "poster"}
YEARS = [2024, 2025, 2026]
# Expected accepts as a share of all submissions; scripts/iclr_sync.py shifts every paper's odds
# by the same amount to hit it. ICLR 2024-2026 accepted 27-32%; 2027 has twice the submissions.
TARGET_SHARE = 0.25


def pct_of(values: np.ndarray, ref: np.ndarray) -> np.ndarray:
    """Share of ref below each value, ties counted half (the same rule the page uses)."""
    s = np.sort(ref)
    return (np.searchsorted(s, values, "left") + np.searchsorted(s, values, "right")) / 2 / len(s)


def conf_scale(rows: list[dict]) -> tuple[float, float]:
    c = np.array([x["confidence"] for r in rows for x in r["reviews"] if x["confidence"]], float)
    return float(c.mean()), float(c.std())


def edge_conf(ratings: list[float], conf: list, scale: tuple[float, float], pick) -> float:
    """Mean z-scored confidence of the reviewers giving the lowest (or highest) score; unknown counts as average."""
    mu, sd = scale
    edge = pick(ratings)
    zs = [((c - mu) / sd) if c else 0.0 for a, c in zip(ratings, conf) if a == edge]
    return float(np.mean(zs))


def raw(rows: list[dict], scale: tuple[float, float]) -> np.ndarray:
    out = []
    for r in rows:
        a = [x["rating"] for x in r["reviews"]]
        c = [x["confidence"] for x in r["reviews"]]
        out.append([np.mean(a), np.min(a), np.max(a), np.std(a), edge_conf(a, c, scale, min), edge_conf(a, c, scale, max)])
    return np.array(out)


def features(r: np.ndarray, ref: np.ndarray) -> np.ndarray:
    p = [pct_of(r[:, j], ref[:, j]) for j in range(3)]
    spread = r[:, 3] / ref[:, 0].std()
    return np.column_stack([p[0], p[1], p[2], spread, p[0] ** 2, p[0] ** 3, r[:, 4], r[:, 5]])


def year(y: int) -> dict:
    rows = [r for r in json.loads((DATA / f"iclr-{y}.json").read_text()) if len(r["reviews"]) >= 3]
    ref = raw(rows, conf_scale(rows))
    dec = np.array([r["outcome"] in ACC | {"rejected"} for r in rows])
    return {"rows": rows, "ref": ref, "X": features(ref, ref)[dec], "y": np.array([r["outcome"] in ACC for r in rows])[dec]}


def fit(ds: list[dict]) -> LogisticRegression:
    return LogisticRegression(max_iter=5000, C=10).fit(np.vstack([d["X"] for d in ds]), np.concatenate([d["y"] for d in ds]))


def main() -> None:
    data = {y: year(y) for y in YEARS}
    test = data[YEARS[-1]]
    m = fit([data[y] for y in YEARS[:-1]])
    p = m.predict_proba(test["X"])[:, 1]
    print(f"train {YEARS[:-1]} -> test {YEARS[-1]}: AUC {roc_auc_score(test['y'], p):.4f}  logloss {log_loss(test['y'], p):.4f}")
    q = np.quantile(p, np.linspace(0, 1, 11))
    for i in range(10):
        s = (p >= q[i]) & (p <= q[i + 1])
        print(f"  predicted {p[s].mean():5.1%} -> accepted {test['y'][s].mean():5.1%}  (n={s.sum()})")
    # Years differ in how noisy reviews are, so a model fit on some years is overconfident on
    # another. Leave one year out, then fit one scale and shift on the held-out logits (Platt).
    z, t = [], []
    for y in YEARS:
        mm = fit([data[o] for o in YEARS if o != y])
        z.append(mm.decision_function(data[y]["X"]))
        t.append(data[y]["y"])
    platt = LogisticRegression(C=1e6).fit(np.concatenate(z)[:, None], np.concatenate(t))
    a, b = float(platt.coef_[0, 0]), float(platt.intercept_[0])
    for y, zz, tt in zip(YEARS, z, t):
        pc = 1 / (1 + np.exp(-(a * zz + b)))
        q = np.quantile(pc, [0, .2, .4, .6, .8, 1])
        cal = " | ".join(f"{pc[(pc >= q[i]) & (pc <= q[i + 1])].mean():.0%}->{tt[(pc >= q[i]) & (pc <= q[i + 1])].mean():.0%}" for i in range(5))
        print(f"  held-out {y}, calibrated: AUC {roc_auc_score(tt, pc):.4f} logloss {log_loss(tt, pc):.4f}  quintiles predicted->actual {cal}")
    m = fit(list(data.values()))
    coef, icpt = (a * m.coef_[0]).tolist(), float(a * m.intercept_[0] + b)
    (Path(__file__).resolve().parent / "iclr-model.json").write_text(json.dumps({"coef": coef, "intercept": icpt, "features": ["pct_mean", "pct_min", "pct_max", "spread", "pct_mean^2", "pct_mean^3", "conf_low_z", "conf_high_z"],
        "targetShare": TARGET_SHARE}))
    print(f"Platt scale {a:.2f} shift {b:+.2f}; wrote scripts/iclr-model.json")


if __name__ == "__main__":
    main()
