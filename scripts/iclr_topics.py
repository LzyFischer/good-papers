"""Competition by topic for the /iclr page: per primary area and per author keyword (30+ papers,
synonyms merged), how many submitted, how many already left, the mean score, and the expected
acceptance rate under the page's model (sum of chances / all submissions in the topic).

scripts/iclr_sync.py calls topics() daily. Two fields need local data and are kept from the last
local run: batch strength (mean score of each paper's 15 nearest submissions, SPECTER2 vectors from
scripts/iclr_embed.py) and last year's submissions and acceptance by area. Locally:
    worker/.venv-embed/bin/python scripts/iclr_topics.py 2027 [--write]
"""
from __future__ import annotations

import json
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
DATA = HERE / "data"
ACC = {"oral", "spotlight", "poster"}
MIN_PAPERS = 30
# Spellings of the same thing; the key is what the table shows.
SYNONYMS = {
    "large language model": ["llm", "llms", "large language models", "large language model (llm)", "large language models (llms)"],
    "vision-language model": ["vlm", "vlms", "vision language model", "vision-language models", "vision language models", "vision-language model (vlm)"],
    "multimodal large language model": ["mllm", "mllms", "multimodal llm", "multimodal llms", "multi-modal large language model"],
    "retrieval-augmented generation": ["rag", "retrieval augmented generation"],
    "reinforcement learning": ["rl"],
    "reinforcement learning from human feedback": ["rlhf"],
    "graph neural network": ["gnn", "gnns", "graph neural networks"],
    "mixture of experts": ["moe", "mixture-of-expert", "mixture-of-experts", "mixture of expert"],
    "llm agent": ["llm-based agent", "llm-based agents", "language agent", "language agents"],
    "vision-language-action model": ["vla", "vlas", "vision-language-action", "vision language action model"],
    "diffusion model": ["diffusion", "diffusion models", "denoising diffusion model"],
    "in-context learning": ["icl", "in context learning"],
    "chain-of-thought": ["cot", "chain of thought", "chain-of-thought reasoning"],
    "parameter-efficient fine-tuning": ["peft", "parameter efficient fine-tuning"],
    "low-rank adaptation": ["lora"],
    "kv cache": ["kv-cache", "key-value cache"],
    "out-of-distribution generalization": ["ood generalization"],
    "out-of-distribution detection": ["ood detection"],
    "benchmark": ["benchmarking", "benchmarks"],
    "ai safety": ["safety"],
}
ALIAS = {a: k for k, al in SYNONYMS.items() for a in al}


def _clean(k: str) -> str:
    k = k.strip().lower().replace("–", "-").replace("_", " ")
    k = re.sub(r"[\"'`.]", "", k)
    k = re.sub(r"\s*-\s*", "-", k)
    return re.sub(r"\s+", " ", k).strip()


def keyword_map(raw_keywords: list[str]) -> dict[str, str]:
    """Each cleaned spelling -> its topic: synonyms merged, plurals folded onto a singular in use."""
    seen = Counter(_clean(k) for k in raw_keywords if _clean(k))
    out = {}
    for k in seen:
        if k in ALIAS:
            out[k] = ALIAS[k]
            continue
        w = k.split(" ")
        last, t = w[-1], k
        for cand in ([last[:-3] + "y"] if last.endswith("ies") else []) + ([last[:-1]] if last.endswith("s") and not last.endswith("ss") else []):
            s = " ".join(w[:-1] + [cand])
            if seen.get(s):
                t = s
                break
        out[k] = ALIAS.get(t, t)
    return out


def topics(rows: list[dict], keywords: dict[str, list[str]], chance: dict[str, float], keep: dict | None = None) -> dict:
    """rows: iclr_sync.submissions(); keywords: id -> raw keywords; chance: id -> chance (papers in review).
    keep: the last topics, whose batch strength and last-year fields carry over."""
    kmap = keyword_map([k for ks in keywords.values() for k in ks])
    mean = {r["id"]: float(np.mean(r["ratings"])) for r in rows if len(r["ratings"]) >= 3}
    old = {("a", x["key"]): x for x in (keep or {}).get("areas", [])} | {("k", x["key"]): x for x in (keep or {}).get("keywords", [])}

    def summarize(kind: str, groups: dict[str, list[dict]], min_n: int) -> list[dict]:
        res = []
        for key, rs in groups.items():
            if len(rs) < min_n:
                continue
            n = len(rs)
            sc = [mean[r["id"]] for r in rs if r["id"] in mean]
            item = {"key": key, "n": n,
                    "left": round(sum(r["outcome"] in ("withdrawn", "desk_rejected") for r in rs) / n, 3),
                    "mean": round(float(np.mean(sc)), 3) if sc else None,
                    "expected": round(sum(chance.get(r["id"], 0) for r in rs) / n, 4)}
            if kind == "k":
                item["area"] = Counter(r["area"] for r in rs if r["area"]).most_common(1)[0][0] if any(r["area"] for r in rs) else None
            prev = old.get((kind, key), {})
            for f in ("batch", "lastN", "lastRate"):
                if prev.get(f) is not None:
                    item[f] = prev[f]
            res.append(item)
        return sorted(res, key=lambda x: -x["n"])

    by_area: dict[str, list[dict]] = defaultdict(list)
    by_kw: dict[str, list[dict]] = defaultdict(list)
    for r in rows:
        by_area[r["area"] or "(none)"].append(r)
        for t in {kmap[c] for c in (_clean(k) for k in keywords.get(r["id"], [])) if c}:
            by_kw[t].append(r)
    return {"areas": summarize("a", by_area, 1), "keywords": summarize("k", by_kw, MIN_PAPERS)}


def raw_keywords(year: int) -> dict[str, list[str]]:
    raw = json.loads((DATA / "pc" / f"iclr{year}.json").read_text())
    return {x["id"]: [k for k in str(x.get("keywords") or "").split(";") if k.strip()] for x in raw}


def local_extras(year: int, rows: list[dict], t: dict) -> None:
    """Batch strength per topic (needs this year's vectors) and last year's numbers by area."""
    mean = {r["id"]: float(np.mean(r["ratings"])) for r in rows if len(r["ratings"]) >= 3}
    order = [r["id"] for r in json.loads((DATA / f"iclr-{year}.json").read_text()) if r["reviews"]]
    vec = np.load(DATA / f"iclr-{year}-all-emb.npy").astype(np.float32)
    have = np.array([i in mean for i in order])
    ids = [i for i, h in zip(order, have) if h]
    v, m = vec[have], np.array([mean[i] for i in ids])
    strength = {}
    for s in range(0, len(v), 3000):
        sim = v[s:s + 3000] @ v.T
        sim[np.arange(len(sim)), np.arange(s, s + len(sim))] = -1
        for k, row in enumerate(np.argpartition(-sim, 15, axis=1)[:, :15]):
            strength[ids[s + k]] = float(m[row].mean())
    kmap = keyword_map([k for ks in raw_keywords(year).values() for k in ks])
    kws = raw_keywords(year)
    members: dict[tuple, list[float]] = defaultdict(list)
    for r in rows:
        if r["id"] not in strength:
            continue
        members[("a", r["area"] or "(none)")].append(strength[r["id"]])
        for tk in {kmap[c] for c in (_clean(k) for k in kws.get(r["id"], [])) if c}:
            members[("k", tk)].append(strength[r["id"]])
    last = defaultdict(lambda: [0, 0])
    for r in json.loads((DATA / f"iclr-{year - 1}.json").read_text()):
        last[r["area"] or "(none)"][0] += 1
        last[r["area"] or "(none)"][1] += r["outcome"] in ACC
    for kind, items in (("a", t["areas"]), ("k", t["keywords"])):
        for x in items:
            if members.get((kind, x["key"])):
                x["batch"] = round(float(np.mean(members[(kind, x["key"])])), 3)
            if kind == "a" and last.get(x["key"], [0])[0]:
                x["lastN"], x["lastRate"] = last[x["key"]][0], round(last[x["key"]][1] / last[x["key"]][0], 3)


def main() -> None:
    sys.path.insert(0, str(HERE))
    import iclr_sync as S

    year = int(sys.argv[1])
    rows = S.submissions(year, False)
    st = S.stats(rows)
    chance = {r["id"]: float(1 / (1 + np.exp(-S.logit(st, r["ratings"], r["confidences"]))))
              for r in rows if r["outcome"] == "pending" and len(r["ratings"]) >= 3}
    t = topics(rows, raw_keywords(year), chance)
    local_extras(year, rows, t)
    print(f"{len(t['areas'])} areas, {len(t['keywords'])} keywords with {MIN_PAPERS}+ papers")
    for x in sorted(t["keywords"], key=lambda x: x["expected"])[:5] + sorted(t["keywords"], key=lambda x: -x["expected"])[:5]:
        print(f"  {x['key'][:40]:40s} n={x['n']:5d} mean={x['mean']} exp={x['expected']:.1%} batch={x.get('batch')}")
    if "--write" in sys.argv:
        res = S.db().patch("/iclr_stats", params={"year": f"eq.{year}"}, json={"topics": t}, headers={"Prefer": "return=minimal"})
        print("written" if res.status_code < 300 else f"write failed: {res.status_code} {res.text[:200]}")


if __name__ == "__main__":
    main()
