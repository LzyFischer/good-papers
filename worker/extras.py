"""Paper extras, run by rp_worker.py each time:

  links:     Hugging Face upvotes, GitHub repo and stars (HF papers API), and a
             thumbnail: the first real figure on the arXiv HTML page.
  tldr:      one sentence on what the paper does (Inkling-Small), shown on cards.
  consensus: one sentence summing up the discussion, Rotten Tomatoes' "critics
             consensus" style, shown under the score; rewritten once a paper has
             gained CONSENSUS_EVERY more comments.
"""

from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import httpx

ARXIV = re.compile(r"arxiv\.org/(?:abs|pdf|html)/(\d{4}\.\d{4,5})|10\.48550/arxiv\.(\d{4}\.\d{4,5})", re.I)
CONSENSUS_MIN = 3     # comments before a paper gets a consensus line
CONSENSUS_EVERY = 3   # new comments before it is rewritten
RECHECK = timedelta(hours=20)  # HF upvotes and stars move; refresh about daily
WORKERS = 8

TLDR_SYSTEM = (
    "You write one-sentence TL;DRs for research papers on a site where people decide what to read. "
    "One plain sentence, at most 25 words: what the paper does and its main result or claim. "
    "No hype, no 'This paper', no 'We', no title restatement, no em dashes. Use only the abstract."
)

CONSENSUS_SYSTEM = (
    "You write the one-line consensus for a paper on Rotten Paper, like a film site's critics consensus: "
    "one sentence, at most 30 words, that captures where the discussion landed, its main praise and its "
    "main reservation. Write it as a verdict, not a summary of who said what; no names or handles, no "
    "'commenters' or 'reviewers', no em dashes. Be fair, quotable, and specific to this paper. The tone is "
    "measured even when the discussion was harsh: no insults or sneers (never words like vaporware, gimmick, "
    "hype), just the strongest praise and the strongest reservation."
)


def clip_words(text: str, n: int) -> str:
    """Cut to n words, ending at the last full clause if there is one."""
    words = text.split()
    if len(words) <= n:
        return text
    cut = " ".join(words[:n])
    end = max(cut.rfind(". "), cut.rfind("; "), cut.rfind(", but"))
    return (cut[:end].rstrip(",;") + ".") if end > len(cut) // 2 else cut.rstrip(",;") + "…"


def arxiv_id(url: str | None) -> str | None:
    m = ARXIV.search(url or "")
    return (m.group(1) or m.group(2)) if m else None


def first_figure(aid: str) -> str | None:
    try:
        r = httpx.get(f"https://arxiv.org/html/{aid}", timeout=20, follow_redirects=True)
    except httpx.HTTPError:
        return None
    if r.status_code != 200:
        return None
    for m in re.finditer(r'<img[^>]*class="ltx_graphics[^"]*"[^>]*>', r.text):
        tag = m.group(0)
        src = re.search(r'src="([^"]+)"', tag)
        width = re.search(r'width="(\d+)"', tag)
        if src and (not width or int(width.group(1)) >= 180) and not src.group(1).endswith(".svg"):
            s = src.group(1)
            return s if s.startswith("http") else f"https://arxiv.org/html/{s.lstrip('/')}"
    return None


def hf_info(aid: str) -> dict:
    try:
        r = httpx.get(f"https://huggingface.co/api/papers/{aid}", timeout=20)
    except httpx.HTTPError:
        return {}
    if r.status_code != 200:
        return {"hf_upvotes": 0}
    d = r.json()
    return {"hf_upvotes": d.get("upvotes") or 0, "github_url": d.get("githubRepo") or None,
            "github_stars": d.get("githubStars")}


def refresh_links(db, limit: int, dry: bool) -> int:
    cutoff = (datetime.now(timezone.utc) - RECHECK).isoformat()
    rows = db.get("papers", select="id,url,thumbnail", order="extras_checked_at.asc.nullsfirst",
                  **{"or": f"(extras_checked_at.is.null,extras_checked_at.lt.{cutoff})"}, limit=str(limit))

    def one(p: dict) -> None:
        aid = arxiv_id(p.get("url"))
        values = {"extras_checked_at": datetime.now(timezone.utc).isoformat()}
        if aid:
            values.update(hf_info(aid))
            if not p.get("thumbnail"):
                fig = first_figure(aid)
                if fig:
                    values["thumbnail"] = fig
        if not dry:
            db.update("papers", {"id": p["id"]}, values)

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(one, rows))
    return len(rows)


def write_tldrs(db, writer, limit: int, dry: bool) -> int:
    rows = db.get("papers", select="id,title,abstract", tldr="is.null", abstract="not.is.null",
                  order="created_at.desc", limit=str(limit))

    def one(p: dict) -> None:
        text = writer.write(TLDR_SYSTEM, f"Title: {p['title']}\nAbstract: {p['abstract']}", max_tokens=80)
        text = text.split("\n")[0].strip()
        if dry:
            print(f"tldr   {p['title'][:50]}: {text}", flush=True)
        elif text:
            db.update("papers", {"id": p["id"]}, {"tldr": text[:300]})

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(one, rows))
    return len(rows)


def write_consensus(db, writer, limit: int, dry: bool, tier_of) -> int:
    counts: dict[str, int] = {}
    for c in db.get("comments", select="paper_id", limit="100000"):
        counts[c["paper_id"]] = counts.get(c["paper_id"], 0) + 1
    papers = {p["id"]: p for p in db.get("papers", select="id,title,abstract,consensus_comments",
                                         id=f"in.({','.join(counts) or 'none'})")} if counts else {}
    todo = [pid for pid, n in counts.items() if n >= CONSENSUS_MIN and pid in papers
            and n - (papers[pid].get("consensus_comments") or 0) >= CONSENSUS_EVERY][:limit]

    def one(pid: str) -> None:
        p = papers[pid]
        comments = db.get("comment_feed", select="author_kind,body,likes", paper_id=f"eq.{pid}",
                          order="likes.desc,created_at.asc", limit="14")
        score = db.get("paper_scores", select="score,reader_total", id=f"eq.{pid}")
        verdict = tier_of(score[0]["score"]) if score and score[0]["score"] is not None else "not rated yet"
        convo = "\n".join(f"- {'(reader) ' if c['author_kind'] == 'user' else ''}{c['body']}" for c in comments)
        text = writer.write(CONSENSUS_SYSTEM, f"Paper: {p['title']}\nAbstract: {p.get('abstract') or ''}\n"
                                              f"Overall rating: {verdict}\n\nDiscussion:\n{convo}", max_tokens=90)
        text = clip_words(text.split("\n")[0].strip(), 36)
        if dry:
            print(f"cons   {p['title'][:50]}: {text}", flush=True)
        elif text:
            db.update("papers", {"id": pid}, {"panel_consensus": text[:400], "consensus_comments": counts[pid]})

    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        list(pool.map(one, todo))
    return len(todo)


def tier_label(score: float) -> str:
    """Mirror of TIERS in lib/types.ts."""
    for minimum, label in ((0.8, "Must read"), (0.65, "Highly rated"), (0.5, "Worth a look"), (0.35, "Mixed reviews")):
        if score >= minimum:
            return label
    return "For specialists"


def run(db, writer, dry: bool, links: int = 200, tldr: int = 100, consensus: int = 60) -> str:
    n_links = refresh_links(db, links, dry)
    n_tldr = write_tldrs(db, writer, tldr, dry)
    n_cons = write_consensus(db, writer, consensus, dry, tier_label)
    return f"extras: links {n_links}, tldr {n_tldr}, consensus {n_cons}"
