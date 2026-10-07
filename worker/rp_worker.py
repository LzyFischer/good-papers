"""Good Papers discussion worker (phase 2).

Runs every few minutes from GitHub Actions (.github/workflows/worker.yml) or by hand:
    worker/.venv/bin/python worker/rp_worker.py [--seed N] [--reply N] [--score N] [--dry-run]

Each run, in order:
  1. score: Jev labels new comments with a graded stance (love .. critical) and how
     quotable they are; the quote score feeds the hot-quotes board.
  2. reply: every reader comment waiting for an answer gets one from an AI persona.
  3. seed:  papers judged by the AI panel but with no discussion get a short
     opening thread (a supporter, a critic replying to them, and a third voice).

Text comes from Inkling-Small on Tinker with thinking effort "none"; Jev cannot
write text. Personas are read from lib/personas.ts so the site and the worker
share one definition. Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
TINKER_API_KEY and TYPESAFE_API_KEY (from the environment or .env.local).
"""

from __future__ import annotations

import argparse
import os
from concurrent.futures import ThreadPoolExecutor
import random
import re
import sys
import time
from pathlib import Path

import httpx

import extras
import reputation
from voices import LENGTH_WORDS, VOICES

ROOT = Path(__file__).resolve().parent.parent
MODEL = os.environ.get("WORKER_MODEL", "thinkingmachines/Inkling-Small")
MAX_WORDS = 70  # hard cap after generation; prompts ask for 25 or 50 depending on the voice
SEED_WORKERS = 8  # papers seeded in parallel


def load_env() -> None:
    env = ROOT / ".env.local"
    if not env.exists():
        return
    for line in env.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


# --- personas (parsed from lib/personas.ts) ---------------------------------

def load_personas() -> dict[str, dict]:
    src = (ROOT / "lib" / "personas.ts").read_text()
    out = {}
    for m in re.finditer(
        r'\n  ([a-z0-9_]+): \{\n    name: "([^"]+)",\n    focus: "([^"]+)",\n    tier: "([a-z]+)",(.*?)\n  \},',
        src,
        re.S,
    ):
        pid, name, focus, tier, rest = m.groups()
        crit = re.search(r'true: "([^"]+)",\s*false: "([^"]+)"', rest)
        out[pid] = {
            "id": pid,
            "name": name,
            "focus": focus,
            "tier": tier,
            "values": crit.group(1) if crit else focus,
            "dislikes": crit.group(2) if crit else "",
        }
    if len(out) < 10:
        sys.exit("Could not parse lib/personas.ts; did its format change?")
    missing = [pid for pid in out if pid not in VOICES]
    if missing:
        sys.exit(f"worker/voices.py has no voice for: {', '.join(missing)}")
    for pid, p in out.items():
        v = VOICES[pid]
        p.update(handle=v["handle"], voice=v["voice"], words=LENGTH_WORDS[v["length"]])
    return out


# --- Supabase (PostgREST with the service role) ------------------------------

class DB:
    def __init__(self) -> None:
        url = os.environ["NEXT_PUBLIC_SUPABASE_URL"].rstrip("/")
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.http = httpx.Client(
            base_url=f"{url}/rest/v1",
            headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            timeout=30,
        )

    def get(self, table: str, **params) -> list[dict]:
        r = self.http.get(f"/{table}", params=params)
        r.raise_for_status()
        return r.json()

    def get_all(self, table: str, order: str, page: int = 1000, **params) -> list[dict]:
        """Every matching row: PostgREST caps a response at 1000 rows. `order` must be unique."""
        out: list[dict] = []
        while True:
            rows = self.get(table, order=order, limit=str(page), offset=str(len(out)), **params)
            out += rows
            if len(rows) < page:
                return out

    def insert(self, table: str, rows: list[dict]) -> list[dict]:
        r = self.http.post(f"/{table}", json=rows, headers={"Prefer": "return=representation"})
        r.raise_for_status()
        return r.json()

    def upsert(self, table: str, rows: list[dict]) -> None:
        r = self.http.post(f"/{table}", json=rows, headers={"Prefer": "resolution=merge-duplicates"})
        r.raise_for_status()

    def delete(self, table: str) -> None:
        """Delete every row (PostgREST requires a filter; created rows always have one of these)."""
        col = {"vote_coi": "user_id", "paper_consensus": "paper_id"}[table]
        r = self.http.delete(f"/{table}", params={col: "not.is.null"})
        r.raise_for_status()

    def update(self, table: str, match: dict, values: dict) -> None:
        r = self.http.patch(f"/{table}", params={k: f"eq.{v}" for k, v in match.items()}, json=values)
        r.raise_for_status()


# --- Jev ----------------------------------------------------------------------

def jev(state: dict, questions: dict) -> dict:
    base = os.environ.get("JEV_BASE_URL", "https://api.typesafe.ai").rstrip("/")
    body = {"model": os.environ.get("JEV_MODEL", "jev-latest"), "state": state, "questions": questions}
    for attempt in range(4):
        r = httpx.post(
            f"{base}/v1/systemone",
            json=body,
            headers={"Authorization": f"Bearer {os.environ['TYPESAFE_API_KEY']}"},
            timeout=60,
        )
        if r.status_code in (429, 529) or r.status_code >= 500:
            time.sleep(0.5 * 2**attempt)
            continue
        r.raise_for_status()
        return r.json()["answers"]
    raise RuntimeError("Jev is overloaded or rate-limited")


COMMENT_QUESTIONS = {
    "stance": {
        "type": "choice",
        "instructions": "How does `comment` feel about whether the paper in `paper_title` is worth reading?",
        "criteria": {
            "love": "Enthusiastic: clearly recommends it, a must-read",
            "like": "Positive overall, with at most minor reservations",
            "mixed": "Balanced, undecided, or mainly a question or summary",
            "doubt": "Skeptical: leans toward not worth reading, but not dismissive",
            "critical": "Clearly argues it is not worth reading",
        },
    },
    "quotable": {
        "type": "noul",
        "instructions": "Read on its own, is `first_sentence` a sharp, specific, quotable take on the paper, the kind worth featuring on a front page?",
        "criteria": {
            "true": "A crisp, memorable line that makes a specific point about this paper",
            "false": "Generic, long-winded, a plain question, a summary, or needs the rest of the comment to make sense",
        },
    },
}


# --- Inkling-Small on Tinker ------------------------------------------------

class Writer:
    def __init__(self) -> None:
        import tinker
        from tinker_cookbook.renderers import Message
        from tinker_cookbook.renderers.tml_v0 import TmlV0Renderer
        from tinker_cookbook.tokenizer_utils import get_tokenizer

        self.tinker = tinker
        self.Message = Message
        self.renderer = TmlV0Renderer(get_tokenizer(MODEL))
        self.client = tinker.ServiceClient().create_sampling_client(base_model=MODEL)

    def write(self, system: str, user: str, max_tokens: int = 220) -> str:
        msgs = [self.Message(role="system", content=system), self.Message(role="user", content=user)]
        # Thinking effort "none": a soft setting, so any reasoning is dropped below.
        prompt = self.renderer.build_generation_prompt(msgs, effort=0.0)
        params = self.tinker.SamplingParams(
            max_tokens=max_tokens, temperature=0.8, stop=self.renderer.get_stop_sequences()
        )
        res = self.client.sample(prompt=prompt, sampling_params=params, num_samples=1).result()
        msg, _ = self.renderer.parse_response(res.sequences[0].tokens)
        content = msg.get("content", "")
        if isinstance(content, list):  # structured content: keep text parts, drop thinking
            content = " ".join(p.get("text", "") for p in content if p.get("type") == "text")
        return clean(content)


def first_sentence(text: str) -> str:
    """What the hot-quotes board shows (mirrors firstSentence in app/page.tsx)."""
    m = re.match(r"^.{20,}?[.!?](?=\s|$)", text, re.S)
    return m.group(0) if m else text


def clean(text: str) -> str:
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    text = re.sub(r"\s+", " ", text).strip()
    # The model sometimes wraps its opening line in quotes: drop that pair.
    if text[:1] in "\"“":
        close = re.search(r'["”]', text[1:])
        text = (text[1 : close.start() + 1] + text[close.end() + 1 :]) if close else text[1:]
    text = text.strip().strip('"“”').strip()
    # Dashes are the loudest AI tell; people type commas.
    text = re.sub(r"\s*[—–]\s*|\s+-\s+", ", ", text)
    text = re.sub(r",\s*,", ",", text).replace("**", "")
    text = re.sub(r"^(As an AI[^.]*\.|Sure[,!.]?|Certainly[,!.]?)\s*", "", text, flags=re.I)
    words = text.split(" ")
    if len(words) > MAX_WORDS:
        cut = " ".join(words[:MAX_WORDS])
        end = max(cut.rfind(". "), cut.rfind("? "), cut.rfind("! "))
        text = cut[: end + 1] if end > len(cut) // 2 else cut + "…"
    return text[:1200]


STYLE = (
    "You are posting in the comment section of Good Papers, a forum where ML researchers argue about whether "
    "papers are worth reading. Your handle is {handle}. Who you are: {voice}. What you look at first: {focus}. "
    "Your personality should come through in how you write, never by describing yourself. Never mention a role, "
    "being a reviewer or persona, or being an AI.\n"
    "Write like a real person typing a forum comment, not like an assistant:\n"
    "- At most {words} words. Short is good. Fragments are fine.\n"
    "- Your first sentence is your sharpest line and must make sense quoted on its own.\n"
    "- Contractions and plain verbs (is, has, does). Have an opinion and own it.\n"
    "- No em dashes or en dashes. No 'not X, but Y' contrasts. No lists of three. No closing summary line.\n"
    "- Avoid crucial, pivotal, robust, showcase, delve, underscore, landscape, notably, compelling, groundbreaking.\n"
    "- No hedging stacks, no pleasantries, no emojis or hashtags.\n"
    "- Do not open with 'I read this', 'This paper', or the title.\n"
    "- Harsh about the work is fine if that's you; never insult people.\n"
    "- Use only what the provided text says. Never invent numbers, results, or flaws.\n"
    "- Don't use the words fresh or rotten."
)


def system_for(p: dict) -> str:
    return STYLE.format(**p)


def pick(cands: list[dict], k: int = 3) -> str:
    """One of the k most convinced personas, so threads don't always open with the same voice."""
    return random.choice(cands[:k])["persona"]


def paper_text(paper: dict) -> str:
    return f"Title: {paper['title']}\nVenue: {paper.get('venue') or 'unknown'}\nAbstract: {paper.get('abstract') or '(none)'}"


# --- AI debate --------------------------------------------------------------

MAX_DEBATE_REPLIES = 4  # replies under the opener, alternating critic and supporter;
# after the first rebuttal the debate goes on only while Jev finds the latest reply adds a new point.
NEW_POINT = {
    "type": "noul",
    "instructions": "Does `comment` make a point about the paper that is not already made in `discussion`?",
    "criteria": {
        "true": "Adds a new argument, detail, or angle",
        "false": "Repeats or rephrases points already made",
    },
}


def debate_turn(writer: Writer, p: dict, paper: dict, thread: list[tuple[str, str]], personas: dict,
                side: str, opener: bool) -> str:
    position = "worth reading" if side == "fresh" else "not worth reading"
    if opener:
        task = (f"You think this paper is {position}. Open the discussion with your take: the one thing that "
                "decides it for you, in your own voice.")
    else:
        convo = "\n".join(f"{personas[pid]['handle']}: {text}" for pid, text in thread)
        task = (f"Discussion so far:\n{convo}\n\nYou think this paper is {position}. Reply directly to the last "
                "comment. Hold your position and do not concede the main point: answer their strongest argument "
                "and bring one point nobody has made yet. Do not open with stock phrases like 'You miss the point' "
                "or 'You say', and don't echo their wording; start with your own claim.")
    return writer.write(system_for(p), f"{paper_text(paper)}\n\n{task}")


def debate(writer: Writer, personas: dict, paper: dict, pro: str, con: str) -> list[tuple[str, str]]:
    """Supporter opens, critic and supporter take turns until Jev finds nothing
    new in the latest reply, or MAX_DEBATE_REPLIES. Each turn is checked with Jev for
    its stance and rewritten once if the persona drifted to the other side."""
    thread: list[tuple[str, str]] = []
    for turn in range(MAX_DEBATE_REPLIES + 1):
        pid, side = (pro, "fresh") if turn % 2 == 0 else (con, "rotten")
        for attempt in range(2):
            text = debate_turn(writer, personas[pid], paper, thread, personas, side, opener=turn == 0)
            convo = "\n".join(f"{personas[q]['handle']}: {t}" for q, t in thread)
            a = jev({"paper_title": paper["title"], "discussion": convo or "(none)", "comment": text},
                    {"stance": COMMENT_QUESTIONS["stance"], "new_point": NEW_POINT})
            want = {"love", "like"} if side == "fresh" else {"doubt", "critical"}
            if a.get("stance", {}).get("choice") in want or attempt == 1:
                break
        if turn >= 2 and a.get("new_point", {}).get("noul", 1.0) < 0.5:
            break  # nothing new: the debate has run its course
        thread.append((pid, text))
    return thread


# --- jobs -------------------------------------------------------------------

def score_comments(db: DB, limit: int, dry: bool) -> int:
    rows = db.get(
        "comments",
        select="id,body,paper_id,papers(title)",
        stance="is.null",
        order="created_at.asc",
        limit=str(limit),
    )
    for c in rows:
        a = jev({"paper_title": (c.get("papers") or {}).get("title", ""), "comment": c["body"],
                 "first_sentence": first_sentence(c["body"])}, COMMENT_QUESTIONS)
        stance = a.get("stance", {}).get("choice", "mixed")
        quote = a.get("quotable", {}).get("noul", 0.0)
        if not dry:
            db.update("comments", {"id": c["id"]}, {"stance": stance, "quote_score": quote})
        print(f"score  {c['id'][:8]}  {stance:7s} quote={quote:.2f}  {c['body'][:60]!r}")
    return len(rows)


def ancestors(db: DB, comment_id: str, depth: int = 8) -> list[dict]:
    """The comment and the chain of comments it replies to, oldest first."""
    chain, cur = [], comment_id
    while cur and len(chain) < depth:
        rows = db.get("comments", select="id,parent_id,author_kind,author_name,persona,body", id=f"eq.{cur}")
        if not rows:
            break
        chain.append(rows[0])
        cur = rows[0]["parent_id"]
    return list(reversed(chain))


def reply_to_readers(db: DB, writer: Writer, personas: dict, limit: int, dry: bool) -> int:
    """Each waiting reader comment gets a reply right under it; a substantive one also
    draws a second agent who answers the first from the other side, so readers see
    agents arguing with each other rather than one bot answering."""
    pending = db.get(
        "comments",
        select="id,paper_id,parent_id,body,author_name,stance",
        needs_reply="is.true",
        author_kind="eq.user",
        order="created_at.asc",
        limit=str(limit),
    )
    for c in pending:
        paper = db.get("papers", select="id,title,venue,abstract", id=f"eq.{c['paper_id']}")[0]
        thread = ancestors(db, c["id"])
        verdicts = [v for v in db.get("ai_verdicts", select="persona,fresh,probability", paper_id=f"eq.{paper['id']}")
                    if v["persona"] in personas]
        # Keep the voice the reader answered; otherwise someone who disagrees with them.
        voice = next((t["persona"] for t in reversed(thread[:-1]) if t["author_kind"] == "ai" and t["persona"]), None)
        if voice not in personas:
            want_fresh = c.get("stance") in ("doubt", "critical")
            pool = [v for v in verdicts if v["fresh"] == want_fresh] or verdicts
            voice = pick(sorted(pool, key=lambda v: -abs(v["probability"] - 0.5))) if pool else "r2"
        p = personas[voice]
        convo = "\n".join(f"{'You' if t.get('persona') == voice else (t['author_name'] or 'reader')}: {t['body']}"
                          for t in thread[-6:])
        text = writer.write(system_for(p), (
            f"{paper_text(paper)}\n\nThread:\n{convo}\n\n"
            f"Reply to {c['author_name'] or 'the reader'}'s latest comment. Engage with their specific point: agree "
            "where they are right, push back where the paper's text says otherwise, and add one concrete angle "
            "they did not mention. You may end with a short question that keeps the discussion going."))
        print(f"reply  {c['id'][:8]}  as {p['handle']}: {text[:90]!r}")
        if dry or not text:
            continue
        first = db.insert("comments", [{
            "paper_id": paper["id"], "parent_id": c["id"], "author_kind": "ai", "user_id": None,
            "author_name": p["handle"], "persona": voice, "body": text,
        }])[0]
        db.update("comments", {"id": c["id"]}, {"needs_reply": False})

        # A second agent from the other side answers the first, if the reader gave them something to chew on.
        if len(c["body"]) < 60:
            continue
        side_fresh = next((v["fresh"] for v in verdicts if v["persona"] == voice), True)
        others = [v for v in verdicts if v["persona"] != voice and v["fresh"] != side_fresh] or \
                 [v for v in verdicts if v["persona"] != voice]
        if not others:
            continue
        q = personas[pick(sorted(others, key=lambda v: -abs(v["probability"] - 0.5)))]
        convo2 = convo + f"\n{p['handle']}: {text}"
        text2 = writer.write(system_for(q), (
            f"{paper_text(paper)}\n\nThread:\n{convo2}\n\n"
            f"Jump in and reply to {p['handle']}'s last comment. You see this paper differently: say where they "
            "are wrong or missing something, using only what the paper's text supports. Address them directly, "
            "don't repeat their wording."))
        if text2:
            db.insert("comments", [{
                "paper_id": paper["id"], "parent_id": first["id"], "author_kind": "ai", "user_id": None,
                "author_name": q["handle"], "persona": q["id"], "body": text2,
            }])
            print(f"reply  ↳ {q['handle']}: {text2[:90]!r}")
    return len(pending)


def seed_discussions(db: DB, writer: Writer, personas: dict, limit: int, dry: bool) -> int:
    papers = db.get(
        "paper_scores",
        select="id,title,venue,published_on",
        ai_total="gt.0",
        area="not.is.null",
        order="last_activity.desc.nullslast",  # papers judged moments ago (opened from search) go first
        limit="200",
    )
    try:
        discussed = {r["paper_id"] for r in db.get_all("comments", "id", select="id,paper_id", author_kind="eq.ai")}
    except httpx.HTTPStatusError:
        if not dry:
            raise
        discussed = set()  # dry run before migration 005: no comments table yet
    todo = [p for p in papers if p["id"] not in discussed][:limit]

    def one(s: dict) -> None:
        paper = db.get("papers", select="id,title,venue,abstract", id=f"eq.{s['id']}")[0]
        if not paper.get("abstract"):
            return
        verdicts = [v for v in db.get("ai_verdicts", select="persona,fresh,probability", paper_id=f"eq.{paper['id']}")
                    if v["persona"] in personas]
        fresh = sorted([v for v in verdicts if v["fresh"]], key=lambda v: -v["probability"])
        rotten = sorted([v for v in verdicts if not v["fresh"]], key=lambda v: v["probability"])
        pro = pick(fresh or verdicts)
        con = pick([v for v in (rotten or verdicts) if v["persona"] != pro])
        middle = pick(sorted(
            [v for v in verdicts if v["persona"] not in (pro, con) and personas[v["persona"]]["tier"] == "medium"]
            or [v for v in verdicts if v["persona"] not in (pro, con)],
            key=lambda v: abs(v["probability"] - 0.5),
        ))

        middle_text = writer.write(
            system_for(personas[middle]),
            f"{paper_text(paper)}\n\nGive your own take on this paper from your angle ({personas[middle]['focus']}), "
            "including what you would want to check before deciding if it is worth reading.",
        )
        thread = debate(writer, personas, paper, pro, con)
        log = [f"seed   {paper['title'][:60]}"]
        log += [f"  {'↳ ' if i else ''}{personas[pid]['handle']}: {text}" for i, (pid, text) in enumerate(thread)]
        log.append(f"  {personas[middle]['handle']}: {middle_text}")
        print("\n".join(log), flush=True)
        if dry:
            return
        ai = {"paper_id": paper["id"], "author_kind": "ai", "user_id": None}
        (pid, text), replies = thread[0], thread[1:]
        first = db.insert("comments", [{**ai, "author_name": personas[pid]["handle"], "persona": pid, "body": text}])[0]
        parent = first["id"]
        for pid, text in replies:  # each turn answers the previous one: a nested chain
            parent = db.insert("comments", [
                {**ai, "parent_id": parent, "author_name": personas[pid]["handle"], "persona": pid, "body": text},
            ])[0]["id"]
        db.insert("comments", [{**ai, "author_name": personas[middle]["handle"], "persona": middle, "body": middle_text}])

    def safe(s: dict) -> None:
        try:
            one(s)
        except Exception as e:  # one bad paper shouldn't stop the run
            print(f"seed   FAILED {s['title'][:60]}: {e}", flush=True)

    with ThreadPoolExecutor(max_workers=SEED_WORKERS) as pool:
        list(pool.map(safe, todo))
    return len(todo)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seed", type=int, default=50, help="papers to open a discussion on")
    ap.add_argument("--reply", type=int, default=30, help="reader comments to answer")
    ap.add_argument("--score", type=int, default=100, help="comments to label with Jev")
    ap.add_argument("--no-reputation", action="store_true", help="skip reader weights and consensus")
    ap.add_argument("--no-extras", action="store_true", help="skip TL;DRs, consensus lines, thumbnails, HF upvotes")
    ap.add_argument("--dry-run", action="store_true", help="print, write nothing")
    args = ap.parse_args()

    load_env()
    personas = load_personas()
    db = DB()
    writer = Writer() if (args.reply or args.seed or not args.no_extras) else None

    if not args.no_reputation:
        try:
            print(reputation.run(db, args.dry_run), flush=True)
        except Exception as e:  # scores still work with last run's weights
            print(f"reputation FAILED: {e}", flush=True)
    n = score_comments(db, args.score, args.dry_run) if args.score else 0
    r = reply_to_readers(db, writer, personas, args.reply, args.dry_run) if args.reply else 0
    s = seed_discussions(db, writer, personas, args.seed, args.dry_run) if args.seed else 0
    # Score what this run just wrote, so new comments reach the hot-quotes board right away.
    if not args.dry_run and (r or s) and args.score:
        n += score_comments(db, args.score, False)
    if not args.no_extras:
        try:
            print(extras.run(db, writer, args.dry_run), flush=True)
        except Exception as e:
            print(f"extras FAILED: {e}", flush=True)
    print(f"done: scored {n}, replied {r}, seeded {s}{' (dry run)' if args.dry_run else ''}")


if __name__ == "__main__":
    main()
