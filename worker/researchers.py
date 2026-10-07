"""Good researchers data, run by rp_worker.py each time:

  authorships: OpenAlex author ids for each stored paper (paper_authors), so two people
               with the same name stay apart. "arxiv-<id>" papers are retried daily
               until OpenAlex has indexed them.
  stats:       each author's citation record from OpenAlex (researchers), refreshed weekly.

The ranking itself is computed by the /researchers page (lib/researchers.ts).
"""

from __future__ import annotations

import os
import re
import time
from datetime import datetime, timedelta, timezone

import httpx

OPENALEX = "https://api.openalex.org"
RETRY_ARXIV = timedelta(days=1)
STATS_EVERY = timedelta(days=7)
ARXIV_ID = re.compile(r"^arxiv-(\d{4}\.\d{4,5})$")


def _get(path: str, params: dict) -> dict | None:
    p = dict(params)
    if os.environ.get("OPENALEX_MAILTO"):
        p["mailto"] = os.environ["OPENALEX_MAILTO"]
    if os.environ.get("OPENALEX_API_KEY"):
        p["api_key"] = os.environ["OPENALEX_API_KEY"]
    for attempt in range(4):  # OpenAlex rate-limits bursts (429) and has the odd 5xx
        try:
            r = httpx.get(f"{OPENALEX}{path}", params=p, timeout=30)
            if r.status_code == 429 or r.status_code >= 500:
                raise httpx.HTTPStatusError("retry", request=r.request, response=r)
            r.raise_for_status()
            return r.json()
        except httpx.HTTPError as e:
            print(f"OpenAlex {path} failed ({e}), attempt {attempt + 1}", flush=True)
            time.sleep(2 ** attempt)
    return None


def short(oa_id: str | None) -> str:
    return str(oa_id or "").rsplit("/", 1)[-1]


def fill_authorships(db, limit: int, dry: bool) -> int:
    now = datetime.now(timezone.utc)
    cutoff = (now - RETRY_ARXIV).isoformat()
    rows = db.get("papers", select="id", limit=str(limit), order="created_at.desc",
                  **{"or": f"(authors_checked_at.is.null,and(id.like.arxiv-*,authors_checked_at.lt.{cutoff}))"})
    if not rows:
        return 0
    works = [r["id"] for r in rows if re.fullmatch(r"W\d+", r["id"])]
    arxiv = {m.group(1): r["id"] for r in rows if (m := ARXIV_ID.match(r["id"]))}

    found: dict[str, list[dict]] = {}  # paper id -> authorships
    for i in range(0, len(works), 50):
        data = _get("/works", {"filter": "openalex_id:" + "|".join(works[i:i + 50]), "per_page": "50",
                               "select": "id,authorships"})
        for w in (data or {}).get("results", []):
            found[short(w["id"])] = w.get("authorships") or []
    aids = list(arxiv)
    for i in range(0, len(aids), 50):
        data = _get("/works", {"filter": "doi:" + "|".join(f"10.48550/arxiv.{a}" for a in aids[i:i + 50]),
                               "per_page": "50", "select": "doi,authorships"})
        for w in (data or {}).get("results", []):
            m = re.search(r"arxiv\.(\d{4}\.\d{4,5})", w.get("doi") or "", re.I)
            if m and m.group(1) in arxiv:
                found[arxiv[m.group(1)]] = w.get("authorships") or []

    links = []
    for pid, authorships in found.items():
        people: dict[str, str | None] = {}
        for a in authorships:
            aid = short((a.get("author") or {}).get("id"))
            if aid and aid not in people:
                insts = a.get("institutions") or []
                people[aid] = insts[0].get("display_name") if insts else None
        for pos, (aid, inst) in enumerate(people.items()):
            links.append({"paper_id": pid, "author_id": aid, "position": pos, "n_authors": len(people),
                          "institution": inst})
    if not dry:
        for i in range(0, len(links), 500):
            db.upsert("paper_authors", links[i:i + 500])
        for r in rows:
            db.update("papers", {"id": r["id"]}, {"authors_checked_at": now.isoformat()})
    return len(found)


def refresh_stats(db, limit: int, dry: bool) -> int:
    links = db.get("paper_authors", select="author_id", limit="100000")
    have = {r["id"]: r["updated_at"] for r in db.get("researchers", select="id,updated_at", limit="100000")}
    cutoff = (datetime.now(timezone.utc) - STATS_EVERY).isoformat()
    todo = [a for a in dict.fromkeys(r["author_id"] for r in links) if a not in have or have[a] < cutoff][:limit]
    rows = []
    for i in range(0, len(todo), 50):
        data = _get("/authors", {"filter": "openalex_id:" + "|".join(todo[i:i + 50]), "per_page": "50",
                                 "select": "id,display_name,works_count,cited_by_count,summary_stats,last_known_institutions"})
        for a in (data or {}).get("results", []):
            stats = a.get("summary_stats") or {}
            insts = a.get("last_known_institutions") or []
            rows.append({
                "id": short(a["id"]),
                "name": a.get("display_name") or "",
                "institution": (insts[0].get("display_name") if insts else None),
                "works_count": a.get("works_count"),
                "cited_by_count": a.get("cited_by_count"),
                "h_index": stats.get("h_index"),
                "two_yr_citedness": stats.get("2yr_mean_citedness"),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
    if rows and not dry:
        db.upsert("researchers", rows)
    return len(rows)


def run(db, dry: bool, papers: int = 300, authors: int = 1500) -> str:
    n_papers = fill_authorships(db, papers, dry)
    n_authors = refresh_stats(db, authors, dry)
    return f"researchers: authorships for {n_papers} papers, stats for {n_authors} authors"
