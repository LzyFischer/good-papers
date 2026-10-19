"use client";
// The home hero's "Would you read it?" deck, swiped like Tinder. It never runs out: the
// paper of the day and this week's trending first, For you papers mixed in as they arrive,
// then pages of recent papers (/api/deck). Drag right (or ♥) if you'd read it, left (or ✕)
// if not, and the card shows what readers and the AI panel made of it before flying off;
// ⏭ moves on without answering and ↺ goes back one. Not a vote (votes are for papers you've
// read): a guest's "I'd read it" counts as interest for their For you shelf
// (guestHistory.ts), like opening the paper would.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toDeckCard, titleKey, type DeckCard } from "@/lib/deck";
import { useSession } from "./AuthButton";
import { useForYou } from "./ForYou";
import { addToHistory } from "./guestHistory";

type Answer = "yes" | "no";
type Exit = Answer | "skip" | "back";
const THROW = 90; // px of drag that counts as a decision
const REVEAL_MS = 1100;
const OUT_MS = 280;

export function HeroDeck({ cards: initial }: { cards: DeckCard[] }) {
  const { session } = useSession();
  const { list: forYou } = useForYou(24);
  const [cards, setCards] = useState(initial);
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [exit, setExit] = useState<Exit | null>(null);
  const [dx, setDx] = useState(0);
  const drag = useRef<{ x: number; id: number; moved: boolean } | null>(null);
  const seen = useRef(new Set(initial.map((c) => titleKey(c.title))));
  const mixed = useRef(false);
  const paging = useRef({ page: 0, more: true, busy: false });

  const fresh = (list: DeckCard[]) =>
    list.filter((c) => {
      const k = titleKey(c.title);
      if (seen.current.has(k)) return false;
      seen.current.add(k);
      return true;
    });

  // For you, once it arrives: alternate it with the cards still ahead.
  useEffect(() => {
    if (!forYou || mixed.current) return;
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
  }, [forYou]);

  // Near the end: fetch the next page of recent papers.
  useEffect(() => {
    const p = paging.current;
    if (cards.length - i > 4 || !p.more || p.busy) return;
    p.busy = true;
    fetch(`/api/deck?page=${p.page}`)
      .then((r) => (r.ok ? r.json() : { cards: [], more: false }))
      .then((r: { cards: DeckCard[]; more: boolean }) => {
        p.page += 1;
        p.more = r.more;
        const add = fresh(r.cards);
        if (add.length) setCards((all) => [...all, ...add]);
      })
      .catch(() => (p.more = false))
      .finally(() => (p.busy = false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i, cards.length]);

  if (!cards.length) return null;
  const c = cards[Math.min(i, cards.length - 1)];
  const atEnd = i >= cards.length;
  const busy = answer !== null || exit !== null;

  function leave(kind: Exit, then: () => void, delay = 0) {
    setTimeout(() => setExit(kind), delay);
    setTimeout(() => {
      setExit(null);
      setAnswer(null);
      setDx(0);
      then();
    }, delay + OUT_MS);
  }

  function decide(a: Answer) {
    if (busy || atEnd) return;
    setAnswer(a);
    setDx(a === "yes" ? 24 : -24);
    if (a === "yes" && !session) addToHistory(c.id, 30);
    leave(a, () => setI((n) => n + 1), REVEAL_MS);
  }
  const skip = () => !busy && !atEnd && leave("skip", () => setI((n) => n + 1));
  const back = () => !busy && i > 0 && leave("back", () => setI((n) => n - 1));

  function onDown(e: React.PointerEvent) {
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

  const agrees = c.tier && (answer === "yes" ? c.tier.tone >= 4 : c.tier.tone <= 3);
  const tilt = Math.max(-1, Math.min(1, dx / 160));
  const style = exit ? undefined : { transform: `translateX(${dx}px) rotate(${tilt * 8}deg)`, transition: drag.current ? "none" : undefined };

  return (
    <div className="deck">
      <div className="deck-stage">
        <div className="deck-ghost deck-ghost--2" aria-hidden="true" />
        <div className="deck-ghost deck-ghost--1" aria-hidden="true" />
        {atEnd ? (
          <div className="deck-card deck-end">
            <span className="deck-kicker">You&apos;ve seen them all</span>
            <p className="deck-end-title">That&apos;s every recent paper we have.</p>
            <div className="deck-end-actions">
              <a href="#trending" className="deck-pill deck-pill--lime">See all trending ↓</a>
              <button className="deck-pill" onClick={() => setI(0)}>Start over</button>
            </div>
          </div>
        ) : (
          <div
            key={c.id}
            className={`deck-card ${exit ? `deck-card--out-${exit}` : ""}`}
            style={style}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onClickCapture={(e) => { if (dx !== 0 && !answer) e.preventDefault(); }}
          >
            <div className="deck-media">
              {c.thumbnail ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.thumbnail} alt="" draggable={false} />
              ) : (
                <span className="deck-media-empty">{c.area ?? "Paper"}</span>
              )}
              <span className="deck-stamp deck-stamp--yes" style={{ opacity: answer === "yes" ? 1 : Math.max(0, tilt * 1.6) }}>Read it</span>
              <span className="deck-stamp deck-stamp--no" style={{ opacity: answer === "no" ? 1 : Math.max(0, -tilt * 1.6) }}>Not for me</span>
            </div>
            <div className="deck-body">
              <span className="deck-kicker">
                {c.kicker}
                {c.area && !c.kicker.toLowerCase().includes(c.area.toLowerCase()) ? ` · ${c.area}` : ""}
              </span>
              <Link href={`/paper/${c.id}`} className="deck-title" draggable={false}>{c.title}</Link>
              {c.tldr && <p className="deck-tldr">{c.tldr}</p>}
            </div>
            {answer && (
              <div className={`deck-verdict tone-${c.tier?.tone ?? 1}`} role="status">
                <b>
                  {c.tier ? c.tier.label : "Not rated yet"}
                  {c.tier && c.open ? ` · ${c.tier.pct}%` : ""}
                </b>
                <span>
                  {!c.tier
                    ? "No verdict yet."
                    : agrees
                      ? "Readers and the AI panel agree with you."
                      : answer === "yes"
                        ? "Readers and the AI panel are less sure."
                        : "Readers and the AI panel liked it more."}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
      <div className="deck-buttons">
        <button className="deck-round deck-round--small deck-round--back" aria-label="Back to the last paper" title="Back" onClick={back} disabled={busy || i === 0}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5" /><path d="M4 9h10a6 6 0 0 1 0 12h-3" /></svg>
        </button>
        <button className="deck-round deck-round--no" aria-label="Not for me" title="Not for me" onClick={() => decide("no")} disabled={busy || atEnd}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <button className="deck-round deck-round--yes" aria-label="I'd read it" title="I'd read it" onClick={() => decide("yes")} disabled={busy || atEnd}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
        </button>
        <button className="deck-round deck-round--small deck-round--skip" aria-label="Skip without answering" title="Skip" onClick={skip} disabled={busy || atEnd}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5l8 7-8 7" /><path d="M13 5l6 7-6 7" /></svg>
        </button>
      </div>
      <p className="deck-hint">Would you read it? Swipe, or skip if you&apos;re not sure.</p>
    </div>
  );
}
