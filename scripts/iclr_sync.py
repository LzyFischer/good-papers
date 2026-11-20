"""Keeps the /iclr page's tables (migration 030) in step with Paper Copilot's crawl of OpenReview.

Daily (.github/workflows/iclr.yml): downloads iclr<year>.json from github.com/papercopilot/paperlists,
writes the rows whose scores or status changed, and refreshes the year's stats row.
Once, locally (needs SPECTER2 vectors from scripts/iclr_embed.py for this year and last year's
decided papers from scripts/iclr_backtest.py): --full also writes each submission's 60 nearest
submissions and the closest accepted papers of the year before, plus last year's outcomes by rank.
    worker/.venv-embed/bin/python scripts/iclr_sync.py 2027 --full [--dry]
    python scripts/iclr_sync.py 2027 --download
Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (env or .env.local).
"""
from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from pathlib import Path

import httpx
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DATA = HERE / "data"
ACC = {"oral", "spotlight", "poster"}
STATUS = {"oral": "oral", "spotlight": "spotlight", "poster": "poster", "reject": "rejected",
          "withdraw": "withdrawn", "desk reject": "desk_rejected", "active": "pending"}
SOURCE = "https://media.githubusercontent.com/media/papercopilot/paperlists/main/iclr/iclr{year}.json"
UA = {"User-Agent": "GoodPapers/1.0 (+https://www.goodpapers.org)"}


def env(key: str) -> str:
    if os.environ.get(key):
        return os.environ[key]
    for line in (ROOT / ".env.local").read_text().splitlines():
        if line.startswith(key + "="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit(f"{key} is not set")


def db() -> httpx.Client:
    key = env("SUPABASE_SERVICE_ROLE_KEY")
    return httpx.Client(base_url=env("NEXT_PUBLIC_SUPABASE_URL").rstrip("/") + "/rest/v1", timeout=120,
                        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})


def nums(s) -> list[float | None]:
    return [float(x) if x.strip() else None for x in str(s).split(";")] if s else []


def submissions(year: int, download: bool) -> list[dict]:
    """Main-track submissions in Paper Copilot's file, in its order."""
    f = DATA / "pc" / f"iclr{year}.json"
    if download:
        f.parent.mkdir(parents=True, exist_ok=True)
        with httpx.stream("GET", SOURCE.format(year=year), headers=UA, timeout=600, follow_redirects=True) as r:
            r.raise_for_status()
            with f.open("wb") as out:
                for chunk in r.iter_bytes():
                    out.write(chunk)
    out = []
    for r in json.loads(f.read_text()):
        st = STATUS.get((r.get("status") or "").strip().lower())
        if r.get("track", "main") != "main" or st is None or not r.get("title"):
            continue
        rating, conf = nums(r.get("rating")), nums(r.get("confidence"))
        keep = [i for i, a in enumerate(rating) if a is not None]
        out.append({"id": r["id"], "year": year, "title": r["title"].strip(), "area": r.get("primary_area") or None,
                    "ratings": [rating[i] for i in keep],
                    "confidences": [conf[i] if i < len(conf) and conf[i] is not None else 0 for i in keep],
                    "outcome": st})
    return out


def stats(rows: list[dict]) -> dict:
    full = [r["ratings"] for r in rows if len(r["ratings"]) >= 3]
    ref = np.array([[np.mean(a), np.min(a), np.max(a)] for a in full])
    grid = np.linspace(1, 4, 121) if ref[:, 0].max() <= 4 else np.linspace(0, 10, 121)
    density = np.exp(-((grid[:, None] - ref[None, :, 0]) / (0.04 * (grid[-1] - grid[0]))) ** 2 / 2).sum(1)
    return {
        "ref": {k: sorted(Counter(ref[:, j].round(4).tolist()).items()) for j, k in enumerate(["mean", "min", "max"])},
        "sdMean": float(ref[:, 0].std()),
        "spreadP75": float(np.quantile([np.std(a) for a in full], 0.75)),
        "scale": [float(grid[0]), float(grid[-1])],
        "hist": list(zip(grid.round(3).tolist(), density.round(1).tolist())),
        "counts": {"submitted": len(rows), "reviewed": len(full),
                   "live": sum(1 for r in rows if r["outcome"] == "pending" and len(r["ratings"]) >= 3),
                   "withdrawn": sum(1 for r in rows if r["outcome"] == "withdrawn"),
                   "deskRejected": sum(1 for r in rows if r["outcome"] == "desk_rejected")},
        "model": json.loads((HERE / "iclr-model.json").read_text()),
    }


def last_year(year: int) -> list[list[int]]:
    """Last year's submissions (3+ reviews) by mean-score rank, 100 bins: [accepted, rejected, withdrawn]."""
    rows = [r for r in json.loads((DATA / f"iclr-{year - 1}.json").read_text()) if len(r["reviews"]) >= 3]
    m = np.array([np.mean([x["rating"] for x in r["reviews"]]) for r in rows])
    s = np.sort(m)
    p = (np.searchsorted(s, m, "left") + np.searchsorted(s, m, "right")) / 2 / len(m)
    bins = [[0, 0, 0] for _ in range(100)]
    for q, r in zip(p, rows):
        if r["outcome"] in ACC | {"rejected", "withdrawn"}:
            bins[min(99, int(q * 100))][0 if r["outcome"] in ACC else 2 if r["outcome"] == "withdrawn" else 1] += 1
    return bins


def neighbors(year: int, rows: list[dict]) -> tuple[dict[str, list[str]], dict[str, list[dict]]]:
    """Each reviewed submission's 60 nearest (same year) and its 6 closest accepted papers of last year."""
    reviewed = [r for r in json.loads((DATA / f"iclr-{year}.json").read_text()) if r["reviews"]]
    vec = np.load(DATA / f"iclr-{year}-all-emb.npy").astype(np.float32)
    assert len(vec) == len(reviewed), "re-run scripts/iclr_embed.py"
    ids = [r["id"] for r in reviewed]
    last = [r for r in json.loads((DATA / f"iclr-{year - 1}.json").read_text()) if r["outcome"] in ACC | {"rejected"} and len(r["reviews"]) >= 3]
    lvec = np.load(DATA / f"iclr-{year - 1}-decided-emb.npy").astype(np.float32)
    acc = [i for i, r in enumerate(last) if r["outcome"] in ACC]
    lvec = lvec[acc]
    near, prev = {}, {}
    for s in range(0, len(vec), 2000):
        sim = vec[s:s + 2000] @ vec.T
        sim[np.arange(len(sim)), np.arange(s, s + len(sim))] = -1
        part = np.argpartition(-sim, 60, axis=1)[:, :60]
        top = np.take_along_axis(part, np.argsort(-np.take_along_axis(sim, part, 1), 1), 1)
        ls = vec[s:s + 2000] @ lvec.T
        ltop = np.argsort(-ls, axis=1)[:, :6]
        for k in range(len(sim)):
            near[ids[s + k]] = [ids[j] for j in top[k]]
            prev[ids[s + k]] = [{"title": last[acc[j]]["title"], "outcome": last[acc[j]]["outcome"],
                                 "ratings": sorted([x["rating"] for x in last[acc[j]]["reviews"]], reverse=True)} for j in ltop[k]]
        print(f"  neighbours {min(s + 2000, len(vec))}/{len(vec)}", flush=True)
    return near, prev


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("year", type=int)
    ap.add_argument("--full", action="store_true", help="also neighbours and last year's table (local, needs vectors)")
    ap.add_argument("--download", action="store_true", help="fetch Paper Copilot's file first")
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    rows = submissions(a.year, a.download)
    st = stats(rows)
    print(f"ICLR {a.year}: {st['counts']}", flush=True)
    http = db()

    if a.full:
        near, prev = neighbors(a.year, rows)
        for r in rows:
            r["neighbors"], r["similar_last"] = near.get(r["id"], []), prev.get(r["id"], [])
        st["lastBins"] = last_year(a.year)
        changed = rows
    else:
        # only rows whose scores or status moved; new submissions arrive without neighbours
        have: dict[str, tuple] = {}
        last_id = ""
        while True:
            res = http.get("/iclr_submissions", params={"select": "id,ratings,confidences,outcome", "year": f"eq.{a.year}",
                                                        "id": f"gt.{last_id}", "order": "id", "limit": "1000"})
            res.raise_for_status()
            page = res.json()
            for p in page:
                have[p["id"]] = (p["ratings"], p["confidences"], p["outcome"])
            if len(page) < 1000:
                break
            last_id = page[-1]["id"]
        changed = [r for r in rows if have.get(r["id"]) != (r["ratings"], r["confidences"], r["outcome"])]
        old = http.get("/iclr_stats", params={"select": "data", "year": f"eq.{a.year}"}).json()
        if old:
            st["lastBins"] = old[0]["data"].get("lastBins")
    print(f"{len(changed)} rows to write", flush=True)
    if a.dry:
        return
    for i in range(0, len(changed), 500):
        batch = [{**r, "updated_at": "now"} for r in changed[i:i + 500]]  # Postgres reads 'now' as the current time
        res = http.post("/iclr_submissions", params={"on_conflict": "id"}, json=batch,
                        headers={"Prefer": "resolution=merge-duplicates,return=minimal"})
        if res.status_code >= 300:
            raise SystemExit(f"write failed: {res.status_code} {res.text[:300]}")
    res = http.post("/iclr_stats", params={"on_conflict": "year"}, json=[{"year": a.year, "data": st, "updated_at": "now"}],
                    headers={"Prefer": "resolution=merge-duplicates,return=minimal"})
    if res.status_code >= 300:
        raise SystemExit(f"stats write failed: {res.status_code} {res.text[:300]}")
    print("done", flush=True)


if __name__ == "__main__":
    main()
