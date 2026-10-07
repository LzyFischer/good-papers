"""Abstracts and arXiv ids for NeurIPS 2026 papers, merged into
scripts/data/neurips-2026-openreview.json, the file scripts/import-neurips.ts reads.

OpenReview keeps NeurIPS 2026 papers private until camera-ready, so this looks each
title up on OpenAlex (exact title match, with our API key) and then on arXiv (exact
title search, one request every 3 seconds as arXiv asks). The arXiv id lets the worker
fetch the paper's first figure and Hugging Face info. Papers already holding an
abstract are skipped, so it's safe to re-run as more papers appear.

    worker/.venv/bin/python scripts/neurips_abstracts.py
"""

from __future__ import annotations

import json
import re
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parent.parent
CONF = ROOT / "neurips-2026-orals-posters.json"
OUT = ROOT / "scripts" / "data" / "neurips-2026-openreview.json"


def norm(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", (t or "").lower()).strip()


def abstract(inv: dict | None) -> str | None:
    if not inv:
        return None
    words: list[str] = []
    for w, pos in inv.items():
        for p in pos:
            if p >= len(words):
                words += [""] * (p + 1 - len(words))
            words[p] = w
    return " ".join(words).strip() or None


def env() -> dict[str, str]:
    out = {}
    for line in (ROOT / ".env.local").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


# OpenAlex's anonymous budget is shared by everyone and runs out; use our key.
AUTH = {k: v for k, v in {"api_key": env().get("OPENALEX_API_KEY"), "mailto": env().get("OPENALEX_MAILTO")}.items() if v}


ARXIV = re.compile(r"arxiv\.org/(?:abs|pdf|html)/(\d{4}\.\d{4,5})|10\.48550/arxiv\.(\d{4}\.\d{4,5})", re.I)


def arxiv_of(*urls: str | None) -> str | None:
    for u in urls:
        m = ARXIV.search(u or "")
        if m:
            return m.group(1) or m.group(2)
    return None


def lookup(client: httpx.Client, title: str) -> dict | None:
    """OpenAlex: {abstract, arxiv} for the work with exactly this title."""
    q = re.sub(r'[,:|()"!]', " ", title)
    for attempt in range(4):
        try:
            r = client.get("https://api.openalex.org/works", params={
                "filter": f"title.search:{q}", "per_page": "5",
                "select": "display_name,abstract_inverted_index,doi,locations", **AUTH})
            if r.status_code == 429:
                print("rate limited, backing off", flush=True)
                raise httpx.HTTPError("rate limited")
            r.raise_for_status()
            for w in r.json().get("results", []):
                if norm(w.get("display_name")) == norm(title):
                    a = abstract(w.get("abstract_inverted_index"))
                    ax = arxiv_of(w.get("doi"), *[l.get("landing_page_url") for l in w.get("locations") or []])
                    if a:
                        return {"abstract": a, "arxiv": ax}
            return None
        except httpx.HTTPError:
            import time
            time.sleep(2 ** attempt)
    return None


def arxiv_lookup(client: httpx.Client, title: str) -> dict | None:
    """arXiv: {abstract, arxiv} for the preprint with exactly this title."""
    q = re.sub(r'["\\():]', " ", title).strip()[:200]
    for attempt in range(3):
        try:
            r = client.get("https://export.arxiv.org/api/query", params={"search_query": f'ti:"{q}"', "max_results": "5"})
            if r.status_code in (429, 503):
                raise httpx.HTTPError(str(r.status_code))
            r.raise_for_status()
            for entry in r.text.split("<entry>")[1:]:
                m = re.search(r"<id>https?://arxiv\.org/abs/(\d{4}\.\d{4,5})(?:v\d+)?</id>", entry)
                t = re.search(r"<title>([\s\S]*?)</title>", entry)
                a = re.search(r"<summary>([\s\S]*?)</summary>", entry)
                if m and t and a and norm(t.group(1)) == norm(title):
                    return {"abstract": re.sub(r"\s+", " ", a.group(1)).strip(), "arxiv": m.group(1)}
            return None
        except httpx.HTTPError:
            import time
            time.sleep(10 * (attempt + 1))
    return None


def main() -> None:
    entries = json.loads(CONF.read_text())["results"]
    titles = {}
    for e in entries:
        m = re.search(r"id=([\w-]+)", e.get("paper_url") or "")
        if m:
            titles[m.group(1)] = e["name"]
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    # SKIP_OPENALEX=1 when today's OpenAlex budget is spent: go straight to arXiv.
    import os
    todo = [] if os.environ.get("SKIP_OPENALEX") else [f for f in titles if not (data.get(f) or {}).get("abstract")]
    OUT.parent.mkdir(parents=True, exist_ok=True)
    print(f"{len(titles)} papers, {len(titles) - len(todo)} already have an abstract, looking up {len(todo)}", flush=True)

    with httpx.Client(timeout=30, headers={"User-Agent": "GoodPapers/0.2"}) as client:
        def one(forum: str) -> tuple[str, str | None]:
            return forum, lookup(client, titles[forum])

        found = 0
        with ThreadPoolExecutor(max_workers=6) as pool:
            for i, (forum, a) in enumerate(pool.map(one, todo), 1):
                if a:
                    found += 1
                    data[forum] = {**(data.get(forum) or {}), "title": titles[forum], **{k: v for k, v in a.items() if v}}
                if i % 250 == 0:
                    print(f"{i}/{len(todo)} looked up, {found} found", flush=True)
                    OUT.write_text(json.dumps(data, ensure_ascii=False))  # progress survives an interrupt
    OUT.write_text(json.dumps(data, ensure_ascii=False))
    print(f"OpenAlex: {found} found", flush=True)

    # arXiv for the rest, one request every 3 seconds.
    import time
    rest = [f for f in titles if not (data.get(f) or {}).get("abstract")]
    print(f"arXiv: looking up {len(rest)}", flush=True)
    with httpx.Client(timeout=30, headers={"User-Agent": "GoodPapers/0.2 (mailto:" + env().get("OPENALEX_MAILTO", "") + ")"}) as client:
        hits = 0
        for i, forum in enumerate(rest, 1):
            a = arxiv_lookup(client, titles[forum])
            if a:
                hits += 1
                data[forum] = {**(data.get(forum) or {}), "title": titles[forum], **a}
            if i % 100 == 0:
                print(f"arXiv: {i}/{len(rest)} looked up, {hits} found", flush=True)
                OUT.write_text(json.dumps(data, ensure_ascii=False))
            time.sleep(3)
    OUT.write_text(json.dumps(data, ensure_ascii=False))
    total = sum(1 for f in titles if (data.get(f) or {}).get("abstract"))
    print(f"done: {total}/{len(titles)} papers have an abstract", flush=True)


if __name__ == "__main__":
    main()
