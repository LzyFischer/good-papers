"use client";
// The home hero's deck of papers to vote on, swiped like Tinder. It never runs out: the
// paper of the day and this week's trending first, For you papers mixed in as they arrive,
// then pages of recent papers (/api/deck). Drag right (or ♥) for "Worth reading", left (or
// ✕) for "Not for me": for a signed-in reader that's a real vote, the same as the buttons on
// the paper page, and it moves the score. The card then shows what readers and the AI panel
// made of it, score included (the vote is in, so it can't sway it), before flying off.
// ⏭ skips a paper you haven't read; ↺ goes back one. Guests can play, but their picks only
// count as interest (guestHistory.ts) until they sign in. Papers answered here before, or
// voted on anywhere, don't come back: the deck picks up where the reader left off.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toDeckCard, titleKey, type DeckCard } from "@/lib/deck";
import { browserClient } from "@/lib/supabase";
import { signIn, useSession } from "./AuthButton";
import { useForYou } from "./ForYou";
import { addToHistory } from "./guestHistory";
import { getMyVotes, setMyVote } from "./myVotes";

// Until a reader first uses the deck, the top card leans right, then left, on each visit to
// show it can be swiped. Set once they swipe, vote, skip or go back.
const HINT_KEY = "gp_deck_hint_seen";
const markUsed = () => {
  try {
    localStorage.setItem(HINT_KEY, "1");
  } catch {}
};

// Papers this browser has answered in the deck, newest last.
const DONE_KEY = "gp_deck_done";
const DONE_MAX = 600;
function readDone(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function markDone(id: string) {
  try {
    localStorage.setItem(DONE_KEY, JSON.stringify([...readDone().filter((x) => x !== id), id].slice(-DONE_MAX)));
  } catch {}
}

type Answer = "yes" | "no";
type Exit = Answer | "skip";
const THROW = 90; // px of drag that counts as a decision
const REVEAL_MS = 1100;
const NUDGE_AFTER = 3; // guests: suggest signing in after this many answers, then every 10
const OUT_MS = 280;

export function HeroDeck({ cards: initial }: { cards: DeckCard[] }) {
  const { session, ready: sessionReady } = useSession();
  const { list: forYou } = useForYou(24);
  const [ready, setReady] = useState(false); // answered papers filtered out
  const done = useRef(new Set<string>());
  const [cards, setCards] = useState(initial);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [exit, setExit] = useState<Exit | null>(null);
  const [dx, setDx] = useState(0);
  const [returning, setReturning] = useState(false);
  const [demo, setDemo] = useState(false);
  const demoTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [guestAnswers, setGuestAnswers] = useState(0);
  const [nudge, setNudge] = useState(false);
  const drag = useRef<{ x: number; id: number; moved: boolean } | null>(null);
  const seen = useRef(new Set(initial.map((c) => titleKey(c.title))));
  const mixed = useRef(false);
  const paging = useRef({ page: 0, more: true, busy: false });

  const fresh = (list: DeckCard[]) =>
    list.filter((c) => {
      if (done.current.has(c.id)) return false;
      const k = titleKey(c.title);
      if (seen.current.has(k)) return false;
      seen.current.add(k);
      return true;
    });

  // Pick up where the visitor left off: drop papers answered here before or already voted on.
  useEffect(() => {
    if (!sessionReady || ready) return;
    let live = true;
    (session ? getMyVotes(session.user.id).catch(() => new Map()) : Promise.resolve(new Map()))
      .then((votes) => {
        if (!live) return;
        done.current = new Set([...readDone(), ...votes.keys()]);
        setCards((all) => all.filter((c) => !done.current.has(c.id)));
        setReady(true);
      });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionReady, session]);

  // For you, once it arrives: alternate it with the cards still ahead.
  useEffect(() => {
    if (!ready || !forYou || mixed.current) return;
    mixed.current = true;
    const mine = fresh(forYou.papers.map((s) => toDeckCard(s, forYou.reasons[s.id] ?? "For you")));
    if (!mine.length) return;
    setCards((all) => {
      const head = all.slice(0, i + 1);
      const rest = all.slice(i + 1);
      const out: DeckCard[] = [];
      for (let k = 0; k < Math.max(rest.length, mine.length); k++) {
        if (rest[k]) out.push(rest[k]);
        if (mine[k]) out.push(mine[k]);
      }
      return [...head, ...out];
    });
    // `i` is read once, when For you lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forYou, ready]);

  // Near the end: fetch more. A page can be all papers the reader already voted on or saw, so
  // keep going (up to 10 pages at a time) until there are new ones or nothing is left.
  useEffect(() => {
    const p = paging.current;
    if (!ready || cards.length - i > 4 || !p.more || p.busy) return;
    p.busy = true;
    (async () => {
      const add: DeckCard[] = [];
      for (let k = 0; k < 10 && p.more && add.length < 6; k++) {
        const r = (await fetch(`/api/deck?page=${p.page}`)
          .then((x) => (x.ok ? x.json() : { cards: [], more: false }))
          .catch(() => ({ cards: [], more: false }))) as { cards: DeckCard[]; more: boolean };
        p.page += 1;
        p.more = r.more;
        add.push(...fresh(r.cards));
      }
      if (add.length) setCards((all) => [...all, ...add]);
    })().finally(() => (p.busy = false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, cards.length, ready]);

  // The swipe hint: once per visit, when the deck first comes into view, until the reader has
  // used the deck once. Skipped when motion is reduced.
  const deckRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ready || !cards.length || !deckRef.current) return;
    try {
      if (localStorage.getItem(HINT_KEY) || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    } catch {
      return;
    }
    const play = () => {
      const steps: [number, () => void][] = [
        [600, () => { setDemo(true); setDx(70); }],
        [1600, () => setDx(-70)],
        [2600, () => setDx(0)],
        [3300, () => setDemo(false)],
      ];
      demoTimers.current = steps.map(([ms, fn]) => setTimeout(fn, ms));
    };
    // Already on screen: play now. Otherwise wait until it's scrolled into view.
    const r = deckRef.current.getBoundingClientRect();
    const onScreen = r.top >= 0 && r.top + r.height * 0.6 <= innerHeight;
    const io = new IntersectionObserver(([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      play();
    }, { threshold: 0.6 });
    if (onScreen) play();
    else io.observe(deckRef.current);
    return () => {
      io.disconnect();
      demoTimers.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);
  const stopDemo = () => {
    if (!demo) return;
    demoTimers.current.forEach(clearTimeout);
    setDemo(false);
    setDx(0);
  };

  const c = cards[Math.min(i, cards.length - 1)];
  const atEnd = ready && i >= cards.length;
  const busy = !ready || !c || answer !== null || exit !== null || nudge;

  function leave(kind: Exit, then: () => void, delay = 0) {
    setTimeout(() => setExit(kind), delay);
    setTimeout(() => {
      setExit(null);
      setAnswer(null);
      setDx(0);
      then();
    }, delay + OUT_MS);
  }

  // A real vote, as VoteButtons casts it: the rating, then the new score for the page.
  async function vote(paperId: string, up: boolean) {
    const db = browserClient();
    const uid = session!.user.id;
    const { error } = await db.from("ratings").upsert({ user_id: uid, paper_id: paperId, worth_reading: up }, { onConflict: "user_id,paper_id" });
    if (error) return;
    await setMyVote(uid, paperId, up);
    window.dispatchEvent(new CustomEvent("gp-voted", { detail: { id: paperId, prev: undefined, next: up } }));
    const { data } = await db.from("paper_scores").select("score, reader_fresh, reader_total").eq("id", paperId).maybeSingle();
    if (data) window.dispatchEvent(new CustomEvent("gp-score", { detail: { id: paperId, score: data.score, fresh: data.reader_fresh, total: data.reader_total } }));
    fetch("/api/voted", { method: "POST" }).catch(() => {});
  }

  function decide(a: Answer) {
    if (busy || atEnd) return;
    markUsed();
    setAnswer(a);
    setDx(a === "yes" ? 24 : -24);
    if (session) vote(c.id, a === "yes");
    else {
      if (a === "yes") addToHistory(c.id, 30);
      const n = guestAnswers + 1;
      setGuestAnswers(n);
      if (n === NUDGE_AFTER || (n > NUDGE_AFTER && (n - NUDGE_AFTER) % 10 === 0)) setTimeout(() => setNudge(true), REVEAL_MS + 300);
    }
    markDone(c.id);
    done.current.add(c.id);
    leave(a, () => setI((n) => n + 1), REVEAL_MS);
  }
  const skip = () => {
    if (busy || atEnd) return;
    markUsed();
    leave("skip", () => setI((n) => n + 1));
  };
  // Back: the last card comes in again from the left; the current one drops behind it.
  function back() {
    markUsed();
    if (busy || i === 0) return;
    setReturning(true);
    setI((n) => n - 1);
    setTimeout(() => setReturning(false), OUT_MS);
  }

  function onDown(e: React.PointerEvent) {
    stopDemo();
    if (busy) return;
    drag.current = { x: e.clientX, id: e.pointerId, moved: false };
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const x = e.clientX - d.x;
    if (!d.moved && Math.abs(x) > 6) {
      d.moved = true;
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    }
    if (d.moved) setDx(x);
  }
  function onUp() {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    if (dx > THROW) decide("yes");
    else if (dx < -THROW) decide("no");
    else setDx(0);
  }

  const agrees = c?.tier && (answer === "yes" ? c.tier.tone >= 4 : c.tier.tone <= 3);
  const next = ready && !atEnd ? cards[i + 1] : undefined;
  const tilt = Math.max(-1, Math.min(1, dx / 160));
  const style = exit ? undefined : { transform: `translateX(${dx}px) rotate(${tilt * 8}deg)`, transition: drag.current ? "none" : undefined };

  return (
    <div ref={deckRef} className={ready && c ? "deck" : "deck deck--loading"}>
      <div className={exit === "yes" || exit === "no" || exit === "skip" ? "deck-stage deck-stage--leaving" : "deck-stage"}>
        <div className="deck-ghost deck-ghost--2" aria-hidden="true" />
        {/* The next paper waits behind this one, so the deck looks like a real stack. Both
            cards are keyed by paper, so when the top one flies off, the waiting card's own
            element becomes the top card: it just keeps moving, nothing is redrawn. */}
        {!next && <div className="deck-ghost deck-ghost--1" aria-hidden="true" />}
        {nudge && (
          <div className="deck-nudge" role="dialog" aria-label="Sign in to vote">
            <span className="deck-kicker">Your picks don&apos;t count yet</span>
            <p className="deck-nudge-title">Sign in to make them votes.</p>
            <p className="deck-nudge-sub">
              You&apos;ve swiped {guestAnswers} papers. Signed in, every swipe is a real vote that moves the paper&apos;s score,
              and your For you feed learns from it.
            </p>
            <div className="deck-end-actions">
              <button className="deck-pill deck-pill--lime" onClick={() => signIn()}>Sign in to vote</button>
              <button className="deck-pill" onClick={() => setNudge(false)}>Keep browsing</button>
            </div>
          </div>
        )}
        {!c ? (
          <div className="deck-card deck-end" aria-hidden="true" />
        ) : atEnd ? (
          <div className="deck-card deck-end">
            <span className="deck-kicker">You&apos;ve seen them all</span>
            <p className="deck-end-title">That&apos;s every recent paper we have.</p>
            <div className="deck-end-actions">
              <a href="#trending" className="deck-pill deck-pill--lime">See all trending ↓</a>
              <button className="deck-pill" onClick={() => { try { localStorage.removeItem(DONE_KEY); } catch {} location.reload(); }}>Start over</button>
            </div>
          </div>
        ) : null}
        {[...(next ? [{ card: next, top: false }] : []), ...(c && !atEnd ? [{ card: c, top: true }] : [])].map(({ card, top }) =>
          top ? (
            <div
              key={card.id}
              className={`deck-card ${exit ? `deck-card--out-${exit}` : returning ? "deck-card--return" : demo ? "deck-card--demo" : ""}`}
              style={style}
              onPointerDown={onDown}
              onPointerMove={onMove}
              onPointerUp={onUp}
              onPointerCancel={onUp}
              onClickCapture={(e) => { if (dx !== 0 && !answer) e.preventDefault(); }}
            >
              <CardFace c={card}>
                <span className="deck-stamp deck-stamp--yes" style={{ opacity: answer === "yes" ? 1 : Math.max(0, tilt * 1.6) }}>Worth it</span>
                <span className="deck-stamp deck-stamp--no" style={{ opacity: answer === "no" ? 1 : Math.max(0, -tilt * 1.6) }}>Not for me</span>
              </CardFace>
              {answer && (
                <div className={`deck-verdict tone-${card.tier?.tone ?? 1}`} role="status">
                  <b>
                    {card.tier ? card.tier.label : "Not rated yet"}
                    {card.tier ? ` · ${card.tier.pct}%` : ""}
                  </b>
                  <span>
                    {!card.tier
                      ? "No verdict yet."
                      : agrees
                        ? "Readers and the AI panel agree with you."
                        : answer === "yes"
                          ? "Readers and the AI panel are less sure."
                          : "Readers and the AI panel liked it more."}
                    {!session && " Sign in so your votes count."}
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div key={card.id} className="deck-card deck-card--next" aria-hidden="true">
              <CardFace c={card} still />
            </div>
          ),
        )}
      </div>
      <div className="deck-buttons" onPointerDown={stopDemo}>
        <button className="deck-round deck-round--small deck-round--back" aria-label="Back to the last paper" title="Back" onClick={back} disabled={busy || i === 0}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
        </button>
        <button className="deck-round deck-round--no" aria-label="Not for me" title="Not for me" onClick={() => decide("no")} disabled={busy || atEnd}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <button className="deck-round deck-round--yes" aria-label="Worth reading" title="Worth reading" onClick={() => decide("yes")} disabled={busy || atEnd}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
        </button>
        <button className="deck-round deck-round--small deck-round--skip" aria-label="Skip: haven't read it" title="Haven't read it" onClick={skip} disabled={busy || atEnd}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l8 7-8 7" /><path d="M13 5l6 7-6 7" /></svg>
        </button>
      </div>
      <p className="deck-hint">Read it? Swipe right if it&apos;s worth reading, left if not. Skip the ones you haven&apos;t read.</p>
    </div>
  );
}

// A card's picture, kicker, title and TL;DR. `still`: the card waiting behind, with no link.
function CardFace({ c, still = false, children }: { c: DeckCard; still?: boolean; children?: React.ReactNode }) {
  // Some extracted "figures" are just a legend or a caption strip: drop very wide or very tall
  // pictures, or ones that fail to load, and show the area instead.
  const [badPic, setBadPic] = useState(false);
  const checkPic = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget;
    if (!w || !h || w / h > 3.2 || h / w > 2.5) setBadPic(true);
  };
  return (
    <>
      <div className="deck-media">
        {c.thumbnail && !badPic ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbnail} alt="" draggable={false} onLoad={checkPic} onError={() => setBadPic(true)} />
        ) : (
          <span className="deck-media-empty">{c.area ?? "Paper"}</span>
        )}
        {children}
      </div>
      <div className="deck-body">
        <span className="deck-kicker">
          {c.kicker}
          {c.area && !c.kicker.toLowerCase().includes(c.area.toLowerCase()) ? ` · ${c.area}` : ""}
        </span>
        {still ? (
          <span className="deck-title">{c.title}</span>
        ) : (
          <Link href={`/paper/${c.id}`} className="deck-title" draggable={false}>{c.title}</Link>
        )}
        {c.tldr && <p className="deck-tldr">{c.tldr}</p>}
      </div>
    </>
  );
}
