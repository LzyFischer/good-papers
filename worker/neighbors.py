"""Nearest neighbours for "For you" (migrations 018-019), from the SPECTER2 vectors.

For every paper on the site and for every topic (the average of its papers), the 20 closest
papers that are recent (published in the last 180 days, or undated like conference papers)
and in scope (have an area). One row per source, upserted in small batches; sources this
run didn't touch (deleted papers, retired topics) are removed at the end.
Run at the end of worker/embed.py; `--dry-run` computes without writing.
"""
import datetime as dt
import json
import sys

import httpx
import numpy as np

TOP = 20
RECENT_DAYS = 180
BATCH_ROWS = 1000


def load(http: httpx.Client) -> tuple[list[str], list[str | None], list[str | None], np.ndarray]:
    ids, areas, dates, vecs = [], [], [], []
    last = None
    while True:
        params = {"select": "id,area,published_on,embedding", "embedding": "not.is.null", "order": "id", "limit": "1000"}
        if last:
            params["id"] = f"gt.{last}"
        r = http.get("/papers", params=params)
        r.raise_for_status()
        rows = r.json()
        for p in rows:
            ids.append(p["id"])
            areas.append(p["area"])
            dates.append(p["published_on"])
            vecs.append(json.loads(p["embedding"]))
        if len(rows) < 1000:
            break
        last = rows[-1]["id"]
    m = np.asarray(vecs, dtype=np.float32)
    m /= np.linalg.norm(m, axis=1, keepdims=True) + 1e-9
    return ids, areas, dates, m


def compute(ids, areas, dates, m) -> list[dict]:
    cutoff = (dt.date.today() - dt.timedelta(days=RECENT_DAYS)).isoformat()
    cand = np.array([a is not None and (d is None or d >= cutoff) for a, d in zip(areas, dates)])
    cand_idx = np.flatnonzero(cand)
    cm = m[cand_idx]

    sources: list[str] = list(ids)
    svecs = [m]
    by_area: dict[str, list[int]] = {}
    for i, a in enumerate(areas):
        if a:
            by_area.setdefault(a, []).append(i)
    for a, members in by_area.items():
        c = m[members].mean(axis=0)
        sources.append(f"area:{a}")
        svecs.append((c / (np.linalg.norm(c) + 1e-9))[None, :])
    sm = np.concatenate(svecs)

    rows: list[dict] = []
    for start in range(0, len(sources), 1024):
        sims = sm[start : start + 1024] @ cm.T  # (batch, candidates)
        k = min(TOP + 1, sims.shape[1])
        top = np.argpartition(-sims, k - 1, axis=1)[:, :k]
        for b in range(sims.shape[0]):
            src = sources[start + b]
            order = [j for j in top[b][np.argsort(-sims[b, top[b]])] if ids[cand_idx[j]] != src][:TOP]
            rows.append({
                "source": src,
                "neighbor_ids": [ids[cand_idx[j]] for j in order],
                "similarities": [round(float(sims[b, j]), 4) for j in order],
            })
    return rows


STALE_HOURS = 20


def stale(http: httpx.Client) -> bool:
    """True when the table is empty or its newest row is older than STALE_HOURS."""
    r = http.get("/paper_neighbors", params={"select": "updated_at", "order": "updated_at.desc", "limit": "1"})
    r.raise_for_status()
    rows = r.json()
    if not rows:
        return True
    newest = dt.datetime.fromisoformat(rows[0]["updated_at"].replace("Z", "+00:00"))
    return dt.datetime.now(dt.timezone.utc) - newest > dt.timedelta(hours=STALE_HOURS)


def run(http: httpx.Client, dry_run: bool = False, new_vectors: int | None = None) -> None:
    """Recompute everything. Reading every vector costs real database IO, so a run after the
    worker skips it unless there are new vectors or the table is getting old (papers age out
    of the recent window daily). new_vectors=None (run by hand) always recomputes."""
    if new_vectors == 0 and not dry_run and not stale(http):
        print("neighbours: no new vectors and the table is recent; skipped", flush=True)
        return
    ids, areas, dates, m = load(http)
    started = dt.datetime.now(dt.timezone.utc).isoformat()
    rows = compute(ids, areas, dates, m)
    print(f"neighbours: {len(ids)} papers, {len(rows)} sources", flush=True)
    if dry_run:
        by_id = dict(zip(ids, areas))
        for row in [r for r in rows if r["source"].startswith("area:")][:2]:
            print(f"  {row['source']}:", [by_id[n] for n in row["neighbor_ids"]][:8])
        return
    for i in range(0, len(rows), BATCH_ROWS):
        batch = [{**r, "updated_at": started} for r in rows[i : i + BATCH_ROWS]]
        r = http.post("/paper_neighbors", json=batch, headers={"Prefer": "resolution=merge-duplicates"}, timeout=60)
        r.raise_for_status()
    # Sources this run didn't write: papers deleted since, topics no longer used.
    r = http.delete("/paper_neighbors", params={"updated_at": f"lt.{started}"}, timeout=60)
    r.raise_for_status()
    print(f"wrote {len(rows)} neighbour rows", flush=True)


if __name__ == "__main__":
    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    from embed import db

    run(db(), dry_run="--dry-run" in sys.argv)
