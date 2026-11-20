"""ICLR submissions with their public reviews and decisions, for the acceptance backtest.

OpenReview now asks anonymous API clients to pass a challenge, so this signs in with the
owner's own account (OPENREVIEW_USERNAME / OPENREVIEW_PASSWORD in .env.local) through the
official client, like scripts/neurips_openreview.py. Writes scripts/data/iclr-<year>.json.
Run locally only:
    worker/.venv-embed/bin/python scripts/iclr_fetch.py 2024 2025 2026 2027
"""
from __future__ import annotations

import json
import re
import sys
import time
from pathlib import Path

import openreview

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "scripts" / "data"


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


def number(v) -> float | None:
    """Ratings come as 6 or "6: marginally above the acceptance threshold"."""
    if isinstance(v, (int, float)):
        return float(v)
    m = re.match(r"\s*(-?\d+(?:\.\d+)?)", str(v or ""))
    return float(m.group(1)) if m else None


def outcome(venueid: str, venue: str, decision: str | None) -> str:
    vid, txt = venueid or "", f"{venue or ''} {decision or ''}".lower()
    if "Withdrawn" in vid:
        return "withdrawn"
    if "Desk_Rejected" in vid:
        return "desk_rejected"
    if "Rejected" in vid or "reject" in txt:
        return "rejected"
    if "oral" in txt:
        return "oral"
    if "spotlight" in txt:
        return "spotlight"
    if "poster" in txt or "accept" in txt:
        return "poster"
    return "pending"


def fetch(client: openreview.api.OpenReviewClient, year: int) -> list[dict]:
    venue = f"ICLR.cc/{year}/Conference"
    notes = client.get_all_notes(invitation=f"{venue}/-/Submission", details="replies")
    out = []
    for n in notes:
        c = n.content
        reviews, decision = [], None
        for r in (n.details or {}).get("replies", []):
            kind = r["invitations"][0].split("/-/")[-1]
            rc = r.get("content", {})
            if kind == "Official_Review":
                reviews.append({
                    "rating": number(value(rc, "rating") or value(rc, "recommendation")),
                    "confidence": number(value(rc, "confidence")),
                    "soundness": number(value(rc, "soundness")),
                    "contribution": number(value(rc, "contribution")),
                    "presentation": number(value(rc, "presentation")),
                    "cdate": r.get("cdate"),
                    "mdate": r.get("mdate"),
                })
            elif kind == "Decision":
                decision = value(rc, "decision")
        out.append({
            "id": n.id,
            "title": value(c, "title"),
            "abstract": value(c, "abstract"),
            "keywords": value(c, "keywords") or [],
            "area": value(c, "primary_area"),
            "venue": value(c, "venue"),
            "venueid": value(c, "venueid"),
            "decision": decision,
            "outcome": outcome(value(c, "venueid"), value(c, "venue"), decision),
            "reviews": [r for r in reviews if r["rating"] is not None],
        })
    return out


def main() -> None:
    years = [int(y) for y in sys.argv[1:]] or [2024, 2025, 2026, 2027]
    e = env()
    user, password = e.get("OPENREVIEW_USERNAME"), e.get("OPENREVIEW_PASSWORD")
    if not user or not password:
        raise SystemExit("Add OPENREVIEW_USERNAME and OPENREVIEW_PASSWORD to .env.local first.")
    client = openreview.api.OpenReviewClient(baseurl="https://api2.openreview.net", username=user, password=password)
    DATA.mkdir(parents=True, exist_ok=True)
    for y in years:
        t = time.time()
        rows = fetch(client, y)
        (DATA / f"iclr-{y}.json").write_text(json.dumps(rows))
        counts: dict[str, int] = {}
        for r in rows:
            counts[r["outcome"]] = counts.get(r["outcome"], 0) + 1
        reviewed = sum(1 for r in rows if r["reviews"])
        print(f"ICLR {y}: {len(rows)} submissions, {reviewed} with reviews, {counts} ({time.time() - t:.0f}s)", flush=True)


if __name__ == "__main__":
    main()
