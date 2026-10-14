"""SPECTER2 embeddings for papers that don't have one yet (migration 017).

SPECTER2 (allenai/specter2_base with the "proximity" adapter) is trained on citations to put
related papers close together. Input: title [SEP] abstract. Output: 768 numbers per paper,
stored in papers.embedding. "For you" (lib/forYou.ts) averages the vectors of the papers a
reader voted on, commented on and read, and recommends the papers closest to that average.

Run by .github/workflows/embed.yml. Locally:
  python3 -m venv worker/.venv-embed && worker/.venv-embed/bin/pip install -r worker/requirements-embed.txt
  worker/.venv-embed/bin/python worker/embed.py --dry-run --limit 20
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import time

import httpx
import torch
from adapters import AutoAdapterModel
from transformers import AutoTokenizer

BATCH = 32
WRITE_EVERY = 200


def db() -> httpx.Client:
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return httpx.Client(
        base_url=f"{url}/rest/v1",
        headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        timeout=60,
    )


def missing(http: httpx.Client, limit: int, all_papers: bool = False) -> list[dict]:
    """Papers without an embedding, newest first. Keyset paging: PostgREST caps a page at 1000."""
    out: list[dict] = []
    last = None
    while len(out) < limit:
        params = {"select": "id,title,abstract", "order": "id", "limit": str(min(1000, limit - len(out)))}
        if not all_papers:
            params["embedding"] = "is.null"
        if last:
            params["id"] = f"gt.{last}"
        r = http.get("/papers", params=params)
        r.raise_for_status()
        rows = r.json()
        out += rows
        if len(rows) < 1000:
            break
        last = rows[-1]["id"]
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="compute but don't write")
    ap.add_argument("--limit", type=int, default=50_000)
    ap.add_argument("--any", action="store_true", help="take papers whether or not they have one (testing)")
    ap.add_argument("--no-neighbors", action="store_true", help="skip recomputing neighbours")
    args = ap.parse_args()

    http = db()
    papers = missing(http, args.limit, args.any)
    print(f"{len(papers)} papers need an embedding", flush=True)
    if papers:
        embed(http, papers, args)
    if not args.dry_run and not args.no_neighbors:
        import neighbors  # worker/neighbors.py: recompute "For you" neighbours from all vectors

        neighbors.run(http, new_vectors=len(papers))


def embed(http: httpx.Client, papers: list[dict], args: argparse.Namespace) -> None:
    torch.set_num_threads(os.cpu_count() or 2)
    tok = AutoTokenizer.from_pretrained("allenai/specter2_base")
    model = AutoAdapterModel.from_pretrained("allenai/specter2_base")
    name = model.load_adapter("allenai/specter2", source="hf", load_as="proximity", set_active=True)
    model.set_active_adapters(name)
    assert model.active_adapters is not None, "SPECTER2 adapter didn't load"
    model.eval()

    pending: list[dict] = []
    sample: list[tuple[str, list[float]]] = []  # dry run: show nearest neighbours
    written = 0
    t0 = time.time()

    def flush() -> None:
        nonlocal written, pending
        if not pending:
            return
        if not args.dry_run:
            r = http.post("/rpc/set_paper_embeddings", json={"rows": pending})
            r.raise_for_status()
            written += r.json()
        pending = []

    for i in range(0, len(papers), BATCH):
        batch = papers[i : i + BATCH]
        text = [(p["title"] or "") + tok.sep_token + (p.get("abstract") or "") for p in batch]
        enc = tok(text, padding=True, truncation=True, max_length=512, return_tensors="pt", return_token_type_ids=False)
        with torch.no_grad():
            vecs = model(**enc).last_hidden_state[:, 0, :]  # the [CLS] token
        for p, v in zip(batch, vecs.tolist()):
            if args.dry_run and len(sample) < 200:
                sample.append((p["title"], v))
            pending.append({"id": p["id"], "embedding": json.dumps([round(x, 5) for x in v])})
        if len(pending) >= WRITE_EVERY:
            flush()
        done = i + len(batch)
        if done % (BATCH * 10) == 0 or done == len(papers):
            print(f"  {done}/{len(papers)} embedded, {time.time() - t0:.0f}s", flush=True)
    flush()
    if args.dry_run and len(sample) > 2:
        m = torch.nn.functional.normalize(torch.tensor([v for _, v in sample]), dim=1)
        sims = m @ m.T
        for i in range(min(3, len(sample))):
            j = int(torch.topk(sims[i], 2).indices[1])
            print(f"  nearest to {sample[i][0][:60]!r}: {sample[j][0][:60]!r} ({sims[i, j]:.2f})")
    print("dry run: nothing written" if args.dry_run else f"wrote {written} embeddings", flush=True)


if __name__ == "__main__":
    try:
        main()
    except httpx.HTTPStatusError as e:
        print(f"Supabase error {e.response.status_code}: {e.response.text[:300]}", file=sys.stderr)
        raise
