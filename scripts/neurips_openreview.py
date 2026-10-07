"""Abstracts, keywords and TL;DRs of NeurIPS 2026 accepted papers from OpenReview.

Signs in with the owner's own OpenReview account (OPENREVIEW_USERNAME / OPENREVIEW_PASSWORD
in .env.local) through the official client, and writes scripts/data/neurips-2026-openreview.json,
keyed by forum id. scripts/import-neurips.ts reads it. Run locally only:

    worker/.venv/bin/pip install openreview-py
    worker/.venv/bin/python scripts/neurips_openreview.py
"""

from __future__ import annotations

import json
import os
from pathlib import Path

import openreview

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "scripts" / "data" / "neurips-2026-openreview.json"
VENUE = "NeurIPS.cc/2026/Conference"


def env() -> dict[str, str]:
    out = {}
    for line in (ROOT / ".env.local").read_text().splitlines():
        if "=" in line and not line.lstrip().startswith("#"):
            k, v = line.split("=", 1)
            out[k.strip()] = v.strip().strip('"').strip("'")
    return out


def value(content: dict, key: str):
    v = content.get(key)
    return v.get("value") if isinstance(v, dict) else v


def main() -> None:
    e = env()
    user, password = e.get("OPENREVIEW_USERNAME"), e.get("OPENREVIEW_PASSWORD")
    if not user or not password:
        raise SystemExit("Add OPENREVIEW_USERNAME and OPENREVIEW_PASSWORD to .env.local first.")
    client = openreview.api.OpenReviewClient(baseurl="https://api2.openreview.net", username=user, password=password)
    notes = client.get_all_notes(content={"venueid": VENUE})
    papers = {}
    for n in notes:
        c = n.content or {}
        papers[n.forum or n.id] = {
            "title": value(c, "title"),
            "abstract": value(c, "abstract"),
            "keywords": value(c, "keywords") or [],
            "tldr": value(c, "TLDR") or value(c, "TL;DR"),
            "venue": value(c, "venue"),
        }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(papers, ensure_ascii=False))
    with_abstract = sum(1 for p in papers.values() if p.get("abstract"))
    print(f"{len(papers)} accepted papers, {with_abstract} with abstracts -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
