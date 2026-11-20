"""SPECTER2 vectors for every ICLR submission of a year that has reviews (any outcome),
cached as scripts/data/iclr-<year>-all-emb.npy in the order of iclr-<year>.json filtered the same way.
    worker/.venv-embed/bin/python scripts/iclr_embed.py 2027 2026
"""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from iclr_backtest import DATA, embed  # noqa: E402


def reviewed(year: int) -> list[dict]:
    return [r for r in json.loads((DATA / f"iclr-{year}.json").read_text()) if r["reviews"]]


if __name__ == "__main__":
    for y in [int(a) for a in sys.argv[1:]]:
        rows = reviewed(y)
        print(f"ICLR {y}: {len(rows)} reviewed submissions", flush=True)
        embed(rows, DATA / f"iclr-{y}-all-emb.npy")
