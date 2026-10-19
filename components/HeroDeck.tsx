"use client";
// The home hero's "Would you read it?" deck: this week's trending papers one card at a time.
// The visitor answers from the title and TL;DR, then sees what the readers and AI panel made
// of it. Not a vote (votes are for papers you've read): a guest's "I'd read it" counts as
// interest for their For you shelf (guestHistory.ts), like opening the paper would.
import Link from "next/link";
import { useState } from "react";
import { useSession } from "./AuthButton";
import { addToHistory } from "./guestHistory";
import { Gauge } from "./Score";

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

export function HeroDeck({ cards }: { cards: DeckCard[] }) {
  const { session } = useSession();
  const [i, setI] = useState(0);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [leaving, setLeaving] = useState<Answer | null>(null);
  const [kept, setKept] = useState(0);

  if (!cards.length) return null;
  const done = i >= cards.length;
  const c = cards[Math.min(i, cards.length - 1)];

  function pick(a: Answer) {
    setAnswer(a);
    if (a === "yes") {
      setKept((k) => k + 1);
      if (!session) addToHistory(c.id, 30);
    }
  }

  function next() {
    setLeaving(answer);
    setTimeout(() => {
      setLeaving(null);
      setAnswer(null);
      setI((n) => n + 1);
    }, 260);
  }

  if (done) {
    return (
      <div className="deck">
        <div className="deck-card deck-end">
          <span className="deck-kicker">That&apos;s this week&apos;s top {cards.length}</span>
          <p className="deck-end-title">
            {kept ? `You'd read ${kept} of them.` : "Nothing caught your eye this week?"}
          </p>
          <p className="deck-end-sub">
            {session
              ? "Your For you shelf below picks up from here."
              : "Your For you shelf below learns from what you picked. Sign in to vote on papers you've read."}
          </p>
          <div className="deck-actions">
            <a href="#trending" className="deck-btn deck-btn--yes">See all trending ↓</a>
            <button className="deck-btn deck-btn--no" onClick={() => setI(0)}>Start over</button>
          </div>
        </div>
      </div>
    );
  }

  const agrees = c.tier && (answer === "yes" ? c.tier.tone >= 4 : c.tier.tone <= 3);

  return (
    <div className="deck" aria-live="polite">
      {/* The next two cards peek out behind the current one. */}
      {i + 2 < cards.length && <div className="deck-ghost deck-ghost--2" aria-hidden="true" />}
      {i + 1 < cards.length && <div className="deck-ghost deck-ghost--1" aria-hidden="true" />}
      <div key={c.id} className={`deck-card ${leaving ? `deck-card--out-${leaving}` : ""}`}>
        <div className="deck-top">
          <span className="deck-kicker">{c.kicker}</span>
          <span className="deck-count">{i + 1} / {cards.length}</span>
        </div>
        {c.thumbnail && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={c.thumbnail} alt="" className="deck-img" />
        )}
        {c.area && <span className="deck-area">{c.area}</span>}
        <Link href={`/paper/${c.id}`} className="deck-title">{c.title}</Link>
        {c.tldr && <p className="deck-tldr">{c.tldr}</p>}

        {answer === null ? (
          <div className="deck-actions">
            <span className="deck-q">Would you read it?</span>
            <button className="deck-btn deck-btn--no" onClick={() => pick("no")}>Skip</button>
            <button className="deck-btn deck-btn--yes" onClick={() => pick("yes")}>I&apos;d read it</button>
          </div>
        ) : (
          <div className={`deck-reveal tone-${c.tier?.tone ?? 1}`}>
            {c.tier && c.open && <Gauge pct={c.tier.pct} tone={c.tier.tone} size="sm" />}
            <div className="deck-verdict">
              <b>{c.tier ? c.tier.label : "Not rated yet"}</b>
              <span>
                {!c.tier
                  ? "Readers haven't weighed in yet."
                  : agrees
                    ? "Readers and the AI panel agree with you."
                    : answer === "yes"
                      ? "Readers and the AI panel are less sure."
                      : "Readers and the AI panel liked it more than you."}
              </span>
            </div>
            <div className="deck-reveal-actions">
              <Link href={`/paper/${c.id}`} className="deck-link">Open</Link>
              <button className="deck-btn deck-btn--yes" onClick={next}>
                {i + 1 < cards.length ? "Next →" : "Done"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
