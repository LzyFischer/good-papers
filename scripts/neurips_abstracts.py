"""Abstracts for NeurIPS 2026 papers from OpenAlex (exact title match), merged into
scripts/data/neurips-2026-openreview.json, the file scripts/import-neurips.ts reads.

OpenReview keeps NeurIPS 2026 papers private until camera-ready, so this fills in what
OpenAlex already has (preprints mostly). Papers already holding an abstract are skipped,
so it's safe to re-run as more papers appear.

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


def lookup(client: httpx.Client, title: str) -> str | None:
    q = re.sub(r'[,:|()"!]', " ", title)
    for attempt in range(4):
        try:
            r = client.get("https://api.openalex.org/works", params={
                "filter": f"title.search:{q}", "per_page": "5", "select": "display_name,abstract_inverted_index", **AUTH})
            if r.status_code == 429:
                print("rate limited, backing off", flush=True)
                raise httpx.HTTPError("rate limited")
            r.raise_for_status()
            for w in r.json().get("results", []):
                if norm(w.get("display_name")) == norm(title):
                    a = abstract(w.get("abstract_inverted_index"))
                    if a:
                        return a
            return None
        except httpx.HTTPError:
            import time
            time.sleep(2 ** attempt)
    return None


def main() -> None:
    entries = json.loads(CONF.read_text())["results"]
    titles = {}
    for e in entries:
        m = re.search(r"id=([\w-]+)", e.get("paper_url") or "")
        if m:
            titles[m.group(1)] = e["name"]
    data = json.loads(OUT.read_text()) if OUT.exists() else {}
    todo = [f for f in titles if not (data.get(f) or {}).get("abstract")]
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
                    data[forum] = {**(data.get(forum) or {}), "title": titles[forum], "abstract": a}
                if i % 250 == 0:
                    print(f"{i}/{len(todo)} looked up, {found} found", flush=True)
                    OUT.write_text(json.dumps(data, ensure_ascii=False))  # progress survives an interrupt
    OUT.write_text(json.dumps(data, ensure_ascii=False))
    total = sum(1 for f in titles if (data.get(f) or {}).get("abstract"))
    print(f"done: {found} new abstracts; {total}/{len(titles)} papers have one")


if __name__ == "__main__":
    main()
