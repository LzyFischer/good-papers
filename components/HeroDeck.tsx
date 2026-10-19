"use client";
// The home hero's "Would you read it?" deck, swiped like Tinder: this week's trending papers
// one card at a time. Drag right (or ♥) if you'd read it, left (or ✕) to skip; the card shows
// what readers and the AI panel made of it, then flies off. Not a vote (votes are for papers
// you've read): a guest's "I'd read it" counts as interest for their For you shelf
// (guestHistory.ts), like opening the paper would.
import Link from "next/link";
import { useRef, useState } from "react";
import { useSession } from "./AuthButton";
import { addToHistory } from "./guestHistory";

export type DeckCard = {
  id: string;
  title: string;
  tldr: string | null;
  thumbnail: string | null;
  area: string | null;
  tier: { label: string; tone: number; pct: number } | null;
  open: boolean; // the score itself shows (paper of the day, top of Trending)
  kicker: string;
};

type Answer = "yes" | "no";
const THROW = 90; // px of drag that counts as a decision
const REVEAL_MS = 1100;

export function HeroDeck({ cards }: { cards: DeckCard[] }) {
  const { session } = useSession();
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [out, setOut] = useState(false);
  const [dx, setDx] = useState(0);
  const [kept, setKept] = useState(0);
  const drag = useRef<{ x: number; id: number; moved: boolean } | null>(null);

  if (!cards.length) return null;
  const done = i >= cards.length;
  const c = cards[Math.min(i, cards.length - 1)];

  function decide(a: Answer) {
    if (answer) return;
    setAnswer(a);
    setDx(a === "yes" ? 24 : -24);
    if (a === "yes") {
      setKept((k) => k + 1);
      if (!session) addToHistory(c.id, 30);
    }
    setTimeout(() => setOut(true), REVEAL_MS);
    setTimeout(() => {
      setOut(false);
      setAnswer(null);
      setDx(0);
      setI((n) => n + 1);
    }, REVEAL_MS + 280);
  }

  function onDown(e: React.PointerEvent) {
    if (answer) return;
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

  const progress = (
    <div className="deck-progress" aria-hidden="true">
      {cards.map((x, k) => <span key={x.id} className={k < i ? "on" : k === i ? "now" : ""} />)}
    </div>
  );

  if (done) {
    return (
      <div className="deck">
        {progress}
        <div className="deck-stage">
          <div className="deck-card deck-end">
            <span className="deck-kicker">That&apos;s this week&apos;s top {cards.length}</span>
            <p className="deck-end-title">{kept ? `You'd read ${kept} of them.` : "Nothing caught your eye?"}</p>
            <p className="deck-end-sub">
              {session
                ? "Your For you shelf below picks up from here."
                : "Your For you shelf below learns from what you picked. Sign in to vote on papers you've read."}
            </p>
            <div className="deck-end-actions">
              <a href="#trending" className="deck-pill deck-pill--lime">See all trending ↓</a>
              <button className="deck-pill" onClick={() => { setI(0); setKept(0); }}>Start over</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const agrees = c.tier && (answer === "yes" ? c.tier.tone >= 4 : c.tier.tone <= 3);
  const tilt = Math.max(-1, Math.min(1, dx / 160));
  const style = out
    ? undefined
    : { transform: `translateX(${dx}px) rotate(${tilt * 8}deg)`, transition: drag.current ? "none" : undefined };

  return (
    <div className="deck">
      {progress}
      <div className="deck-stage">
        {i + 2 < cards.length && <div className="deck-ghost deck-ghost--2" aria-hidden="true" />}
        {i + 1 < cards.length && <div className="deck-ghost deck-ghost--1" aria-hidden="true" />}
        <div
          key={c.id}
          className={`deck-card ${out ? `deck-card--out-${answer}` : ""}`}
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
            <span className="deck-stamp deck-stamp--no" style={{ opacity: answer === "no" ? 1 : Math.max(0, -tilt * 1.6) }}>Skip</span>
          </div>
          <div className="deck-body">
            <span className="deck-kicker">
              {c.kicker}{c.area ? ` · ${c.area}` : ""}
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
      </div>
      <div className="deck-buttons">
        <button className="deck-round deck-round--no" aria-label="Skip" onClick={() => decide("no")} disabled={!!answer}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <Link className="deck-round deck-round--open" aria-label="Open the paper" href={`/paper/${c.id}`}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8" /></svg>
        </Link>
        <button className="deck-round deck-round--yes" aria-label="I'd read it" onClick={() => decide("yes")} disabled={!!answer}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" /></svg>
        </button>
      </div>
      <p className="deck-hint">Would you read it? Swipe or tap.</p>
    </div>
  );
}
