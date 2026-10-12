"""Nearest neighbours for "For you" (migration 018), from the SPECTER2 vectors.

For every paper "For you" can start from (one a signed-in reader engaged with in the last
120 days, or any recent one, since visitors who aren't signed in mostly open recent papers
and their history stays in the browser) and for every topic (the average of its papers),
the 20 closest papers that are recent (published in the last 180 days, or undated like
conference papers) and in scope (have an area). So the table grows with reader activity and
the recent window, not with the number of papers. Written to paper_neighbors_next, then
swapped in at once.
Run at the end of worker/embed.py; `--dry-run` computes without writing.
"""
import datetime as dt
import json
import sys

import httpx
import numpy as np

TOP = 20
RECENT_DAYS = 180
ACTIVITY_DAYS = 120  # = WINDOW_DAYS in lib/forYou.ts
BATCH_ROWS = 5000


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


def engaged(http: httpx.Client) -> set[str]:
    """Papers someone voted on, commented on or read recently (keyset-paged: 1000 rows a page)."""
    since = (dt.date.today() - dt.timedelta(days=ACTIVITY_DAYS)).isoformat()
    out: set[str] = set()
    for table, col in (("ratings", "updated_at"), ("comments", "created_at"), ("reader_views", "day")):
        offset = 0
        while True:
            params = {"select": "paper_id", col: f"gte.{since}", "order": f"{col}.asc", "limit": "1000", "offset": str(offset)}
            if table == "comments":
                params["author_kind"] = "eq.user"
            r = http.get(f"/{table}", params=params)
            r.raise_for_status()
            rows = r.json()
            out.update(x["paper_id"] for x in rows)
            if len(rows) < 1000:
                break
            offset += 1000
    return out


def compute(ids, areas, dates, m, sources_of_interest: set[str] | None = None) -> list[dict]:
    cutoff = (dt.date.today() - dt.timedelta(days=RECENT_DAYS)).isoformat()
    cand = np.array([a is not None and (d is None or d >= cutoff) for a, d in zip(areas, dates)])
    cand_idx = np.flatnonzero(cand)
    cm = m[cand_idx]

    keep = [i for i, pid in enumerate(ids) if sources_of_interest is None or pid in sources_of_interest or cand[i]]
    sources: list[str] = [ids[i] for i in keep]
    svecs = [m[keep]]
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
            order = top[b][np.argsort(-sims[b, top[b]])]
            rank = 0
            for j in order:
                nid = ids[cand_idx[j]]
                if nid == src:
                    continue
                rows.append({"s": src, "r": rank, "n": nid, "v": round(float(sims[b, j]), 4)})
                rank += 1
                if rank == TOP:
                    break
    return rows


def run(http: httpx.Client, dry_run: bool = False) -> None:
    ids, areas, dates, m = load(http)
    seen = engaged(http)
    rows = compute(ids, areas, dates, m, seen)
    print(f"neighbours: {len(ids)} papers, {len(seen)} with reader activity, {len({r['s'] for r in rows})} sources, {len(rows)} rows", flush=True)
    if dry_run:
        by_id = dict(zip(ids, areas))
        for src in [s for s in {r["s"] for r in rows} if s.startswith("area:")][:2]:
            print(f"  {src}:", [by_id[r["n"]] for r in rows if r["s"] == src][:8])
        return
    for i in range(0, len(rows), BATCH_ROWS):
        r = http.post("/rpc/stage_paper_neighbors", json={"rows": rows[i : i + BATCH_ROWS], "reset": i == 0}, timeout=120)
        r.raise_for_status()
    r = http.post("/rpc/publish_paper_neighbors", json={}, timeout=120)
    r.raise_for_status()
    print(f"published {r.json()} neighbour rows", flush=True)


if __name__ == "__main__":
    sys.path.insert(0, __file__.rsplit("/", 1)[0])
    from embed import db

    run(db(), dry_run="--dry-run" in sys.argv)
