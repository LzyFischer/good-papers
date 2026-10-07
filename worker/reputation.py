"""Reader reputation, conflicts of interest, and cross-camp consensus.

Run by rp_worker.py each time (job "reputation"). Writes, with the service role:
  reader_profiles  each reader's vote weight and inferred identity (private)
  vote_coi         votes that don't count: the reader's own papers, co-authors', same institution
  paper_consensus  per-paper reader share after removing "camp" effects

Identity is inferred from the GitHub login (Supabase auth metadata + public GitHub
profile) against OpenAlex authors:
  * name + an institution signal (GitHub company, blog or email domain) that matches
    one candidate's institution: that author, their institutions and co-authors;
  * name only: every exact-name AI/CS author's institutions, but only when there are
    at most MAX_NAME_ONLY_CANDIDATES of them (common names are skipped);
  * papers in our database that list the reader's exact name as an author: their
    institutions and co-authors (catches people OpenAlex splits into many records).
A wrong guess only means a vote is set aside, never that it counts double.

Weight (0.1 .. 2): new readers start at 0.5 and reach 1 after ~10 votes; agreeing
with what other readers concluded raises it up to 2x; upvoting one institution's
papers while downvoting everyone else's lowers it.

Consensus: votes are fitted with a one-factor model, Community Notes style:
  vote ≈ mu + reader_bias + paper_bias + reader_factor * paper_factor
The factor soaks up camp agreement (a group that always votes together), so the
paper's intercept is how much readers across camps like it.
"""

from __future__ import annotations

import os
import re
import unicodedata
from collections import defaultdict
from urllib.parse import urlparse

import httpx
import numpy as np

MAX_NAME_ONLY_CANDIDATES = 3
CONSENSUS_MIN_RATERS = 8  # per paper; the view uses the consensus from this many raters
CONSENSUS_MIN_VOTES = 40  # in total, before the model is worth fitting
AI_CS_FIELDS = {"Computer Science", "Mathematics", "Engineering", "Decision Sciences"}


def norm(s: str | None) -> str:
    s = unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode()
    return " ".join(re.sub(r"[^a-z0-9 ]+", " ", s.lower()).split())


def domain(s: str | None) -> str | None:
    if not s:
        return None
    s = s.strip().lower()
    host = s.split("@", 1)[1] if "@" in s and "/" not in s else urlparse(s if "//" in s else "//" + s).hostname
    if not host:
        return None
    parts = host.split(".")
    return ".".join(parts[-2:]) if len(parts) >= 2 else host


class OpenAlex:
    def __init__(self) -> None:
        self.http = httpx.Client(base_url="https://api.openalex.org", timeout=30)
        self.mail = os.environ.get("OPENALEX_MAILTO")
        self._inst: dict[str, dict] = {}

    def get(self, path: str, **params) -> dict:
        if self.mail:
            params["mailto"] = self.mail
        if os.environ.get("OPENALEX_API_KEY"):
            params["api_key"] = os.environ["OPENALEX_API_KEY"]
        r = self.http.get(path, params=params)
        r.raise_for_status()
        return r.json()

    def authors_named(self, name: str) -> list[dict]:
        res = self.get("/authors", search=name, per_page="25",
                       select="id,display_name,display_name_alternatives,last_known_institutions,affiliations,topics")
        out = []
        for a in res.get("results", []):
            names = {norm(a["display_name"]), *map(norm, a.get("display_name_alternatives") or [])}
            fields = {t.get("field", {}).get("display_name") for t in (a.get("topics") or [])[:5]}
            if norm(name) in names and fields & AI_CS_FIELDS:
                out.append(a)
        return out

    def institution(self, inst_id: str) -> dict:
        if inst_id not in self._inst:
            self._inst[inst_id] = self.get(f"/institutions/{inst_id.rsplit('/', 1)[-1]}",
                                           select="id,display_name,homepage_url")
        return self._inst[inst_id]

    def coauthors(self, author_id: str, since: str) -> list[str]:
        res = self.get("/works", filter=f"author.id:{author_id.rsplit('/', 1)[-1]},from_publication_date:{since}",
                       per_page="100", select="authorships")
        names = {a["author"]["display_name"] for w in res.get("results", []) for a in w.get("authorships", [])}
        return sorted(names)


def author_institutions(a: dict, since_year: int) -> list[dict]:
    insts = {i["id"]: i for i in a.get("last_known_institutions") or []}
    for aff in a.get("affiliations") or []:
        if max(aff.get("years") or [0]) >= since_year:
            insts[aff["institution"]["id"]] = aff["institution"]
    return list(insts.values())


def infer_identity(user: dict, gh: dict, oa: OpenAlex, since: str) -> dict:
    """{'author': id|None, 'name': str, 'institutions': [...], 'coauthors': [...]}"""
    name = gh.get("name") or user.get("full_name") or user.get("name") or ""
    out = {"author": None, "name": name, "institutions": [], "coauthors": []}
    if len(norm(name).split()) < 2:
        return out
    cands = oa.authors_named(name)
    if not cands:
        return out
    since_year = int(since[:4])
    signals = {d for d in (domain(gh.get("blog")), domain(gh.get("email")), domain(user.get("email"))) if d}
    company = norm(gh.get("company"))

    def matches(inst: dict) -> bool:
        info = oa.institution(inst["id"])
        n = norm(info.get("display_name"))
        return (domain(info.get("homepage_url")) in signals) or (company and (company in n or n in company))

    confirmed = [a for a in cands if any(matches(i) for i in author_institutions(a, since_year))] if (signals or company) else []
    if len(confirmed) == 1:
        a = confirmed[0]
        out["author"] = a["id"]
        out["institutions"] = [i["display_name"] for i in author_institutions(a, since_year)]
        out["coauthors"] = [n for n in oa.coauthors(a["id"], since) if norm(n) != norm(name)]
    elif len(cands) <= MAX_NAME_ONLY_CANDIDATES:
        out["institutions"] = sorted({i["display_name"] for a in cands for i in author_institutions(a, since_year)})
    return out


def coi_reason(ident: dict, gh_names: set[str], paper: dict) -> str | None:
    authors = {norm(a) for a in paper.get("authors") or []}
    if authors & gh_names:
        return "author"
    if authors & {norm(c) for c in ident.get("coauthors", [])}:
        return "coauthor"
    orgs = {norm(o) for o in paper.get("orgs") or []}
    if orgs & {norm(i) for i in ident.get("institutions", [])}:
        return "institution"
    return None


def weights(votes: list[tuple[str, str, bool]], paper_orgs: dict[str, list[str]],
            ai_share: dict[str, float]) -> dict[str, dict]:
    """votes: (user, paper, upvote) without COI votes. Returns per-user weight info."""
    by_paper = defaultdict(list)
    for u, p, v in votes:
        by_paper[p].append((u, v))
    by_user = defaultdict(list)
    for u, p, v in votes:
        by_user[u].append((p, v))

    out = {}
    for u, vs in by_user.items():
        n = len(vs)
        base = 0.5 + 0.5 * min(1.0, n / 10)
        # Agreement with what everyone else concluded (others' majority, else the AI panel).
        agree = 0
        for p, v in vs:
            others = [x for uu, x in by_paper[p] if uu != u]
            ref = (sum(others) / len(others)) if len(others) >= 2 else ai_share.get(p, 0.5)
            agree += (v and ref >= 0.5) or (not v and ref < 0.5)
        agreement = (agree + 2) / (n + 4)  # shrunk toward 0.5 for readers with few votes
        agree_factor = min(2.0, max(0.5, 2 * agreement))
        # Favoritism: upvotes concentrated on one institution, downvotes elsewhere.
        fav = 0.0
        insts = defaultdict(list)
        for p, v in vs:
            for o in set(paper_orgs.get(p) or []):
                insts[o].append(v)
        for o, inside in insts.items():
            outside = [v for p, v in vs if o not in set(paper_orgs.get(p) or [])]
            if len(inside) >= 3 and outside:
                gap = sum(inside) / len(inside) - sum(outside) / len(outside)
                fav = max(fav, gap * min(1.0, len(inside) / 5))
        fav = max(0.0, min(1.0, fav))
        w = base * agree_factor * (1 - 0.8 * fav)
        out[u] = {"weight": round(min(2.0, max(0.1, w)), 3), "votes": n,
                  "agreement": round(agreement, 3), "favoritism": round(fav, 3)}
    return out


def bridge(votes: list[tuple[str, str, bool]], iters: int = 3000, seed: int = 0) -> dict[str, tuple[float, int]]:
    """Fit vote ≈ mu + b_u + b_p + f_u * f_p; return {paper: (share, raters)}."""
    users = sorted({u for u, _, _ in votes})
    papers = sorted({p for _, p, _ in votes})
    ui = {u: i for i, u in enumerate(users)}
    pi = {p: i for i, p in enumerate(papers)}
    U = np.array([ui[u] for u, _, _ in votes])
    P = np.array([pi[p] for _, p, _ in votes])
    Y = np.array([1.0 if v else -1.0 for _, _, v in votes])
    rng = np.random.default_rng(seed)
    mu, bu, bp = 0.0, np.zeros(len(users)), np.zeros(len(papers))
    fu, fp = rng.normal(0, 0.1, len(users)), rng.normal(0, 0.1, len(papers))
    nu = np.maximum(1, np.bincount(U, minlength=len(users)))
    npp = np.maximum(1, np.bincount(P, minlength=len(papers)))
    lam_b, lam_f, lr = 0.15, 0.03, 0.1  # intercepts regularized harder than factors (Community Notes)
    for _ in range(iters):
        err = (mu + bu[U] + bp[P] + fu[U] * fp[P]) - Y
        mu -= lr * err.mean()
        bu -= lr * (np.bincount(U, err, len(users)) / nu + lam_b * bu)
        bp -= lr * (np.bincount(P, err, len(papers)) / npp + lam_b * bp)
        gu = np.bincount(U, err * fp[P], len(users)) / nu + lam_f * fu
        gp = np.bincount(P, err * fu[U], len(papers)) / npp + lam_f * fp
        fu -= lr * gu
        fp -= lr * gp
    raters = np.bincount(P, minlength=len(papers))
    return {p: (float(np.clip((mu + bp[pi[p]] + 1) / 2, 0, 1)), int(raters[pi[p]])) for p in papers}


def run(db, dry: bool) -> str:
    url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    r = httpx.get(f"{url}/auth/v1/admin/users", params={"per_page": "1000"},
                  headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=30)
    r.raise_for_status()
    users = {u["id"]: (u.get("user_metadata") or {}) for u in r.json().get("users", [])}

    ratings = db.get_all("ratings", "user_id,paper_id", select="user_id,paper_id,worth_reading", worth_reading="not.is.null")
    voted_papers = sorted({x["paper_id"] for x in ratings})
    papers = {}
    for i in range(0, len(voted_papers), 100):
        chunk = voted_papers[i:i + 100]
        for p in db.get("papers", select="id,authors,orgs", id=f"in.({','.join(chunk)})"):
            papers[p["id"]] = p
    ai = {s["id"]: (s["ai_fresh"] / s["ai_total"]) for s in db.get_all(
        "paper_scores", "id", select="id,ai_fresh,ai_total", ai_total="gt.0")}

    gh_token = os.environ.get("GITHUB_TOKEN")
    gh_headers = {"Authorization": f"Bearer {gh_token}"} if gh_token else {}
    oa = OpenAlex()
    since = f"{__import__('datetime').date.today().year - 3}-01-01"

    voters = sorted({x["user_id"] for x in ratings})
    idents, coi = {}, []
    for uid in voters:
        meta = users.get(uid, {})
        login = meta.get("user_name") or meta.get("preferred_username")
        gh = {}
        if login:
            g = httpx.get(f"https://api.github.com/users/{login}", headers=gh_headers, timeout=20)
            gh = g.json() if g.status_code == 200 else {}
        try:
            ident = infer_identity(meta, gh, oa, since)
        except httpx.HTTPError:
            ident = {"author": None, "name": "", "institutions": [], "coauthors": []}
        idents[uid] = (login, ident)
        gh_names = {norm(n) for n in (gh.get("name"), meta.get("full_name"), meta.get("name")) if n and len(norm(n).split()) >= 2}
        # The reader's own papers in our database (exact name in the author list).
        for n in {n for n in (gh.get("name"), meta.get("full_name"), meta.get("name")) if n and len(norm(n).split()) >= 2}:
            for own in db.get("papers", select="id,authors,orgs", authors=f'cs.{{"{n}"}}', limit="200"):
                ident["institutions"] = sorted(set(ident["institutions"]) | set(own.get("orgs") or []))
                ident["coauthors"] = sorted(set(ident["coauthors"]) | {a for a in own.get("authors") or [] if norm(a) not in gh_names})
                ident.setdefault("own_papers", 0)
                ident["own_papers"] += 1
        for x in ratings:
            if x["user_id"] == uid and x["paper_id"] in papers:
                reason = coi_reason(ident, gh_names, papers[x["paper_id"]])
                if reason:
                    coi.append({"user_id": uid, "paper_id": x["paper_id"], "reason": reason})

    coi_keys = {(c["user_id"], c["paper_id"]) for c in coi}
    clean = [(x["user_id"], x["paper_id"], bool(x["worth_reading"])) for x in ratings
             if (x["user_id"], x["paper_id"]) not in coi_keys]
    w = weights(clean, {p: v.get("orgs") or [] for p, v in papers.items()}, ai)
    consensus = {}
    if len(clean) >= CONSENSUS_MIN_VOTES:
        consensus = {p: v for p, v in bridge(clean).items() if v[1] >= CONSENSUS_MIN_RATERS}

    if not dry:
        db.delete("vote_coi")
        if coi:
            db.insert("vote_coi", coi)
        rows = []
        for uid in voters:
            login, ident = idents[uid]
            info = w.get(uid, {"weight": 0.5, "votes": 0, "agreement": None, "favoritism": None})
            rows.append({"user_id": uid, "github_login": login, "openalex_author": ident["author"],
                         "institutions": ident["institutions"], "coauthors": ident["coauthors"][:500], **info})
        if rows:
            db.upsert("reader_profiles", rows)
        db.delete("paper_consensus")
        if consensus:
            db.insert("paper_consensus", [{"paper_id": p, "bridged": s, "raters": n} for p, (s, n) in consensus.items()])
    named = sum(1 for _, i in idents.values() if i["author"] or i.get("own_papers"))
    inst = sum(1 for _, i in idents.values() if i["institutions"])
    return (f"reputation: {len(voters)} readers ({named} matched to an author or own papers, {inst} with institutions), "
            f"{len(coi)} conflict-of-interest votes, consensus on {len(consensus)} papers")
