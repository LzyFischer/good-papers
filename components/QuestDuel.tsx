"use client";
// A NeurIPS Quest duel: five rounds of "which poster did readers rate higher?", ten seconds
// each, against another player (answers arrive over Realtime) or an attendee bot. Answers
// are revealed as tier labels only, so a duel never gives away a gated score.
import { useEffect, useRef, useState } from "react";
import type { QuestPaper } from "@/lib/quest";

export const ROUNDS = 5;
const ROUND_MS = 10_000;
const REVEAL_MS = 1800;
export type Answer = { pick: 0 | 1; ms: number };
export type Opponent = { nick: string; id?: string; skill?: number }; // skill: a bot's chance of answering right

// Five pairs from different tiers, so every round has a right answer.
export function makePairs(papers: QuestPaper[]): [string, string][] {
  const rated = papers.filter((p) => p.tone > 0);
  const out: [string, string][] = [];
  for (let tries = 0; out.length < ROUNDS && tries < 200; tries++) {
    const a = rated[Math.floor(Math.random() * rated.length)], b = rated[Math.floor(Math.random() * rated.length)];
    if (a && b && a.tone !== b.tone && !out.some(([x, y]) => [x, y].includes(a.id) || [x, y].includes(b.id))) out.push([a.id, b.id]);
  }
  return out;
}
const points = (a: Answer | undefined, right: 0 | 1) => (a && a.pick === right ? 100 + Math.round((50 * Math.max(0, ROUND_MS - a.ms)) / ROUND_MS) : 0);

export function QuestDuel({ papers, pairs, opp, theirs, onAnswer, onDone, sfx }: {
  papers: Map<string, QuestPaper>;
  pairs: [string, string][];
  opp: Opponent;
  theirs: Record<number, Answer>; // the other player's answers, by round
  onAnswer: (round: number, a: Answer) => void;
  onDone: (mine: number, theirs: number) => void;
  sfx: (k: "tap" | "coin" | "vote" | "win") => void;
}) {
  const [round, setRound] = useState(0);
  const [mine, setMine] = useState<Record<number, Answer>>({});
  const [bot, setBot] = useState<Record<number, Answer>>({});
  const [reveal, setReveal] = useState(false);
  const [now, setNow] = useState(() => performance.now());
  const start = useRef(performance.now());
  const done = round >= pairs.length;
  const other = opp.skill !== undefined ? bot : theirs;
  const pair = done ? null : pairs[round].map((id) => papers.get(id)!);
  const right: 0 | 1 = pair && pair[1].tone > pair[0].tone ? 1 : 0;

  // A new round: restart the clock; a bot thinks for 2 to 7 seconds.
  useEffect(() => {
    if (done) return;
    start.current = performance.now();
    setReveal(false);
    if (opp.skill === undefined) return;
    const ms = 2000 + Math.random() * 5000;
    const t = setTimeout(() => setBot((b) => ({ ...b, [round]: { pick: (Math.random() < opp.skill! ? right : 1 - right) as 0 | 1, ms } })), ms);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, done]);
  useEffect(() => {
    if (done) return;
    const t = setInterval(() => setNow(performance.now()), 100);
    return () => clearInterval(t);
  }, [done]);
  // The round ends when both have answered or time is up; then the answer shows for a moment.
  const elapsed = now - start.current;
  useEffect(() => {
    if (done || reveal) return;
    if ((mine[round] && other[round]) || elapsed >= ROUND_MS) {
      setReveal(true);
      sfx(mine[round]?.pick === right ? "coin" : "tap");
    }
  }, [mine, other, elapsed, round, done, reveal, right, sfx]);
  // Its own effect, so the clock ticking doesn't cancel the move to the next round.
  useEffect(() => {
    if (!reveal) return;
    const t = setTimeout(() => setRound((r) => r + 1), REVEAL_MS);
    return () => clearTimeout(t);
  }, [reveal]);

  const myScore = pairs.reduce((s, p, i) => s + (i < round || (i === round && reveal) ? points(mine[i], rightOf(i)) : 0), 0);
  const theirScore = pairs.reduce((s, p, i) => s + (i < round || (i === round && reveal) ? points(other[i], rightOf(i)) : 0), 0);
  function rightOf(i: number): 0 | 1 {
    const [a, b] = pairs[i].map((id) => papers.get(id)!);
    return b.tone > a.tone ? 1 : 0;
  }
  useEffect(() => {
    if (done) onDone(myScore, theirScore);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done]);

  function choose(pick: 0 | 1) {
    if (reveal || mine[round]) return;
    const a = { pick, ms: Math.round(performance.now() - start.current) };
    setMine((m) => ({ ...m, [round]: a }));
    onAnswer(round, a);
    sfx("vote");
  }

  if (done || !pair) return null;
  const left = Math.max(0, ROUND_MS - elapsed);
  return (
    <div className="quest-modal" role="dialog" aria-label={`Duel against ${opp.nick}`}>
      <div className="quest-modal-box quest-duel">
        <p className="quest-kicker">⚔️ DUEL · ROUND {round + 1}/{pairs.length}</p>
        <div className="quest-duel-score">
          <span>YOU <b>{myScore}</b></span>
          <span>{opp.nick.toUpperCase()} <b>{theirScore}</b></span>
        </div>
        <span className="quest-xp quest-duel-timer"><i style={{ width: `${(left / ROUND_MS) * 100}%` }} /></span>
        <h3>WHICH ONE DID READERS RATE HIGHER?</h3>
        <div className="quest-duel-pair">
          {pair.map((p, i) => {
            const picked = mine[round]?.pick === i, theirsPicked = reveal && other[round]?.pick === i;
            const cls = reveal ? (i === right ? "right" : "wrong") : picked ? "picked" : "";
            return (
              <button key={p.id} className={`quest-duel-card ${cls}`} onClick={() => choose(i as 0 | 1)} disabled={reveal || Boolean(mine[round])}>
                <span className="quest-board">#{p.b}</span>
                <span className="quest-title">{p.t}</span>
                {reveal && <span className="quest-duel-tier">{p.tier.toUpperCase()}</span>}
                <span className="quest-duel-marks">
                  {picked && <em>YOU</em>}
                  {theirsPicked && <em>{opp.nick.split(" ")[0].toUpperCase()}</em>}
                </span>
              </button>
            );
          })}
        </div>
        <p className="quest-meta">
          {reveal
            ? mine[round]?.pick === right ? "Right! +" + points(mine[round], right) : mine[round] ? "Not this time." : "Too slow!"
            : mine[round] ? `Waiting for ${opp.nick}…` : `${Math.ceil(left / 1000)}s · faster answers score more`}
        </p>
      </div>
    </div>
  );
}
