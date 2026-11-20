"""Paper Copilot's crawled ICLR lists (github.com/papercopilot/paperlists, iclr/iclr<year>.json,
downloaded into scripts/data/pc/) to the format scripts/iclr_fetch.py writes, main track only.
    python3 scripts/iclr_from_papercopilot.py 2024 2025 2026 2027
"""
import json
import sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / "data"
STATUS = {"oral": "oral", "spotlight": "spotlight", "poster": "poster", "reject": "rejected",
          "withdraw": "withdrawn", "desk reject": "desk_rejected", "active": "pending"}


def nums(s: str) -> list:
    return [float(x) if x.strip() else None for x in (s or "").split(";")] if s else []


for y in [int(a) for a in sys.argv[1:]] or [2024, 2025, 2026, 2027]:
    raw = json.loads((DATA / "pc" / f"iclr{y}.json").read_text())
    out = []
    for r in raw:
        st = STATUS.get((r.get("status") or "").strip().lower())
        if r.get("track", "main") != "main" or st is None:
            continue
        rating, conf = nums(r.get("rating")), nums(r.get("confidence"))
        reviews = [{"rating": a, "confidence": conf[i] if i < len(conf) else None} for i, a in enumerate(rating) if a is not None]
        out.append({"id": r["id"], "title": r.get("title"), "abstract": r.get("abstract"),
                    "keywords": (r.get("keywords") or "").split(";"), "area": r.get("primary_area"),
                    "outcome": st, "reviews": reviews})
    (DATA / f"iclr-{y}.json").write_text(json.dumps(out))
    c = {}
    for r in out:
        c[r["outcome"]] = c.get(r["outcome"], 0) + 1
    print(y, len(out), c)
