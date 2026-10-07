"""Paper extras, run by rp_worker.py each time:

  links:     Hugging Face upvotes, GitHub repo and stars (HF papers API), and a
             thumbnail: the first real figure on the arXiv HTML page.
  tldr:      one sentence on what the paper does (Inkling-Small), shown on cards.
  consensus: one sentence summing up the discussion, a "critics
             consensus" style, shown under the score; rewritten once a paper has
             gained CONSENSUS_EVERY more comments.
"""

from __future__ import annotations

import re
import time
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
    "You write the one-line consensus for a paper on Good Papers, like a film site's critics consensus: "
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


# Venue detection: arXiv comments ("Accepted to NeurIPS 2025"), journal_ref, and the
# published versions OpenAlex knows. Order matters: NAACL/EACL before ACL.
VENUES = [
    (r"neurips|nips\b|neural information processing systems", "NeurIPS"), (r"\bicml\b|international conference on machine learning", "ICML"),
    (r"\biclr\b|learning representations", "ICLR"), (r"\bcvpr\b|computer vision and pattern recognition", "CVPR"),
    (r"\biccv\b", "ICCV"), (r"\beccv\b", "ECCV"), (r"\bnaacl\b", "NAACL"), (r"\beacl\b", "EACL"),
    (r"\bemnlp\b|empirical methods in natural language", "EMNLP"), (r"\bcoling\b", "COLING"), (r"\bcolm\b", "COLM"),
    (r"\bacl\b|association for computational linguistics", "ACL"), (r"\baaai\b", "AAAI"), (r"\bijcai\b", "IJCAI"),
    (r"\bkdd\b|knowledge discovery and data mining", "KDD"), (r"\bwww\b|the web conference", "WWW"), (r"\bsigir\b", "SIGIR"),
    (r"\bcikm\b", "CIKM"), (r"\bwsdm\b", "WSDM"), (r"\baistats\b", "AISTATS"), (r"\buai\b", "UAI"), (r"\bcorl\b", "CoRL"),
    (r"\bicra\b", "ICRA"), (r"\biros\b", "IROS"), (r"\brss\b|robotics: science and systems", "RSS"),
    (r"\bmiccai\b", "MICCAI"), (r"\bisbi\b", "ISBI"), (r"\bicassp\b", "ICASSP"), (r"\binterspeech\b", "Interspeech"),
    (r"\btmlr\b|transactions on machine learning research", "TMLR"), (r"\bjmlr\b|journal of machine learning research", "JMLR"),
    (r"\btpami\b|pattern analysis and machine intelligence", "TPAMI"), (r"\blog\b.*graphs", "LoG"),
]
VENUE_TAGS = [(r"\boral\b", "Oral"), (r"\bspotlight\b", "Spotlight"), (r"\bfindings\b", "Findings"), (r"\bworkshop\b", "Workshop")]


def detect_venue(texts: list[str], fallback_year: int | None) -> tuple[str | None, list[str]]:
    for text in texts:
        low = (text or "").lower()
        if not low or "arxiv" in low and len(low) < 30:
            continue
        for pattern, short in VENUES:
            if re.search(pattern, low):
                year = re.search(r"\b(20[12]\d)\b", low)
                y = year.group(1) if year else (str(fallback_year) if fallback_year else "")
                tags = [t for p, t in VENUE_TAGS if re.search(p, low)]
                return f"{short} {y}".strip(), tags
    return None, []


def arxiv_meta(ids: list[str]) -> dict[str, list[str]]:
    """comment and journal_ref for each arXiv id (100 per request)."""
    out: dict[str, list[str]] = {}
    for i in range(0, len(ids), 100):
        batch = ids[i:i + 100]
        try:
            r = httpx.get("https://export.arxiv.org/api/query",
                          params={"id_list": ",".join(batch), "max_results": str(len(batch))}, timeout=30)
        except httpx.HTTPError:
            continue
        for entry in r.text.split("<entry>")[1:]:
            m = re.search(r"<id>https?://arxiv\.org/abs/([^<]+?)(?:v\d+)?</id>", entry)
            if not m:
                continue
            texts = [re.sub(r"\s+", " ", x) for x in re.findall(r"<arxiv:(?:comment|journal_ref)[^>]*>([\s\S]*?)</arxiv:", entry)]
            out[m.group(1)] = texts
        time.sleep(3)  # arXiv asks for one request every three seconds
    return out


def openalex_venues(ids: list[str]) -> dict[str, list[str]]:
    """Names of non-arXiv sources where OpenAlex lists a version of each work."""
    out: dict[str, list[str]] = {}
    works = [i for i in ids if re.fullmatch(r"W\d+", i)]
    for i in range(0, len(works), 50):
        try:
            r = httpx.get("https://api.openalex.org/works", timeout=30, params={
                "filter": "openalex_id:" + "|".join(works[i:i + 50]), "per_page": "50", "select": "id,locations"})
            r.raise_for_status()
        except httpx.HTTPError:
            continue
        for w in r.json().get("results", []):
            names = [((l.get("source") or {}).get("display_name") or "") for l in w.get("locations") or []]
            out[w["id"].rsplit("/", 1)[-1]] = [n for n in names if n and "arxiv" not in n.lower()]
    return out


def refresh_links(db, limit: int, dry: bool) -> int:
    cutoff = (datetime.now(timezone.utc) - RECHECK).isoformat()
    rows = db.get("papers", select="id,url,thumbnail,venue,tags,year", order="extras_checked_at.asc.nullsfirst",
                  **{"or": f"(extras_checked_at.is.null,extras_checked_at.lt.{cutoff})"}, limit=str(limit))

    aids = {p["id"]: arxiv_id(p.get("url")) for p in rows}
    ax = arxiv_meta([a for a in aids.values() if a])
    oa = openalex_venues([p["id"] for p in rows])

    def one(p: dict) -> None:
        aid = aids[p["id"]]
        values = {"extras_checked_at": datetime.now(timezone.utc).isoformat()}
        venue, tags = detect_venue([*ax.get(aid or "", []), *oa.get(p["id"], []), p.get("venue") or ""], p.get("year"))
        if venue and venue != p.get("venue"):
            values["venue"] = venue
        new_tags = [t for t in tags if t not in (p.get("tags") or [])]
        if new_tags:
            values["tags"] = (p.get("tags") or []) + new_tags
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
    for minimum, label in ((0.8, "Must read"), (0.65, "Highly rated"), (0.5, "Worth a look"), (0.35, "Niche pick")):
        if score >= minimum:
            return label
    return "Specialist read"


def run(db, writer, dry: bool, links: int = 200, tldr: int = 100, consensus: int = 60) -> str:
    n_links = refresh_links(db, links, dry)
    n_tldr = write_tldrs(db, writer, tldr, dry)
    n_cons = write_consensus(db, writer, consensus, dry, tier_label)
    return f"extras: links {n_links}, tldr {n_tldr}, consensus {n_cons}"
