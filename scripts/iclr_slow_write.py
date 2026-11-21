"""Rewrites iclr_submissions rows (same-area neighbours) gently, for the small Supabase database:
50 rows a request, at least 10 s apart; before each request, a read like the home page's (the 20
newest papers with abstracts): over 1 s pauses 3 min, over 3 s or an error pauses 10 min, until it
is fast again. Stops after 3 failed writes in a row. Resume with --start <row> (rows go in a fixed order).
    worker/.venv-embed/bin/python scripts/iclr_slow_write.py 2027 near.json [--start 4000]
"""
import json
import sys
import time

import httpx

import iclr_sync as S


def main() -> None:
    year, near_file = int(sys.argv[1]), sys.argv[2]
    cached = json.load(open(near_file))
    rows = S.submissions(year, False)
    for r in rows:
        r["neighbors"], r["similar_last"] = cached["near"].get(r["id"], []), cached["prev"].get(r["id"], [])
    http = S.db()
    # resume by position: rows are always written in the same order (scanning the table for what's
    # done needs a full read, which the small database can't take while it's busy)
    start = int(sys.argv[sys.argv.index("--start") + 1]) if "--start" in sys.argv else 0
    todo = rows[start:]
    print(f"starting at row {start:,}: {len(todo):,} to go", flush=True)
    def health() -> float:
        t = time.time()
        try:
            r = http.get("/papers", params={"select": "id,title,abstract", "order": "created_at.desc", "limit": "20"}, timeout=15)
            return time.time() - t if r.status_code < 300 else 99.0
        except httpx.HTTPError:
            return 99.0

    fails, t0, i, n, paused = 0, time.time(), 0, 0, 0.0
    while i < len(todo):
        lag = health()
        if lag > 1:
            wait = 600 if lag > 3 else 180
            print(f"  site reads {lag:.1f}s at row {i:,}: pausing {wait // 60} min", flush=True)
            paused += wait
            time.sleep(wait)
            continue
        batch = [{**r, "updated_at": "now"} for r in todo[i:i + 50]]
        t = time.time()
        try:
            res = http.post("/iclr_submissions", params={"on_conflict": "id"}, json=batch, timeout=30,
                            headers={"Prefer": "resolution=merge-duplicates,return=minimal"})
            ok = res.status_code < 300
            err = "" if ok else f"{res.status_code} {res.text[:200]}"
        except httpx.TimeoutException as e:
            ok, err = False, f"timeout {e}"
        took = time.time() - t
        if not ok:
            fails += 1
            print(f"  batch at {i:,} failed ({err}); pausing 10 min ({fails}/3)", flush=True)
            if fails >= 3:
                raise SystemExit(f"stopped at row {i:,} of {len(todo):,}; rerun with --start {start + i} to resume")
            time.sleep(600)
            continue  # same batch again
        fails = 0
        if n % 40 == 0:
            print(f"  {min(i + 50, len(todo)):,}/{len(todo):,} written, write {took:.1f}s, read {lag:.2f}s, "
                  f"{(time.time() - t0) / 60:.0f} min elapsed ({paused / 60:.0f} paused)", flush=True)
        time.sleep(max(10.0, 5 * took))
        i, n = i + 50, n + 1
    print(f"done in {time.time() - t0:.0f}s", flush=True)


if __name__ == "__main__":
    main()
