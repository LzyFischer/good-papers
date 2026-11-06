"use client";
// NeurIPS Quest: a poster session drawn as a pixel-art hall. Tap any poster and the explorer
// walks there; pick topics for a quest of the best posters in them. Wandering attendees drop
// hints, coffee speeds you up, and one golden poster is hidden in every hall. Visits and votes
// earn XP, levels and badges (kept in this browser); signed-in readers' votes are real votes.
// Everyone in the same hall sees each other (Supabase Realtime presence: nickname and where
// they're headed, nothing else) and can chat (app/api/quest-chat, signed in to post).
// Board numbers are placeholders (lib/quest.ts) until NeurIPS publishes the real ones.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { City, QuestPaper, QuestSession } from "@/lib/quest";
import { SHIRTS, idHash, nickFor } from "@/lib/questNames";
import { browserClient } from "@/lib/supabase";
import { signIn, useSession } from "./AuthButton";
import { setMyVote } from "./myVotes";
import { QuestDuel, makePairs, type Answer, type Opponent } from "./QuestDuel";

const CITY_LIST: City[] = ["Sydney", "Atlanta", "Paris"];
const ZONES: Record<City, string> = { Sydney: "Australia/Sydney", Atlanta: "America/New_York", Paris: "Europe/Paris" };
const QUEST_SIZE = 8;
const STORE = "gp_quest";
const MUTE = "gp_quest_mute";
const TONES = ["#8b8fa0", "#8b8fa0", "#c37ad2", "#7c82f0", "#33b0dd", "#4fbf4f"]; // by tier tone 0..5

// ---- Hall geometry, in canvas pixels. Islands of double-sided boards with aisles between. ----
const X0 = 4, AISLE = 16, ISL_W = 10, BOARD_W = 4, CELL_H = 6, Y0 = 30;
type Pt = { x: number; y: number };
type Hall = { islands: number; per: number; w: number; h: number; top: number; bottom: number; door: Pt };
function hallFor(n: number): Hall {
  // Roughly 3:2, so a big Sydney hall and a small Paris one both fill the screen.
  const islands = Math.max(4, Math.round(Math.sqrt(n * 0.185)));
  const per = Math.max(8, Math.ceil(n / (islands * 2)));
  const w = X0 * 2 + AISLE + islands * (ISL_W + AISLE);
  const bottom = Y0 + per * CELL_H + 7;
  return { islands, per, w, h: bottom + 26, top: Y0 - 8, bottom, door: { x: aisleX(Math.round(islands / 2)), y: bottom + 20 } };
}
const aisleX = (k: number) => X0 + AISLE / 2 + k * (ISL_W + AISLE);
function spotOf(b: number, hall: Hall) {
  const i = Math.floor((b - 1) / (hall.per * 2)), face = Math.floor(((b - 1) % (hall.per * 2)) / hall.per), pos = (b - 1) % hall.per;
  const ix = X0 + AISLE + i * (ISL_W + AISLE);
  return { x: face ? ix + ISL_W - BOARD_W : ix, y: Y0 + pos * CELL_H + 1, face, stand: { x: aisleX(face ? i + 1 : i), y: Y0 + pos * CELL_H + 3 } };
}
// Aisles run up and down; to switch aisles, walk to the nearer cross corridor (top or bottom).
function route(from: Pt, to: Pt, hall: Hall): Pt[] {
  if (Math.abs(from.x - to.x) < 1) return [to];
  const viaTop = Math.abs(from.y - hall.top) + Math.abs(to.y - hall.top);
  const viaBot = Math.abs(from.y - hall.bottom) + Math.abs(to.y - hall.bottom);
  const cy = from.y > hall.bottom ? hall.bottom : viaTop < viaBot ? hall.top : hall.bottom;
  return [{ x: from.x, y: cy }, { x: to.x, y: cy }, to];
}
const pathLen = (pts: Pt[], start: Pt) => pts.reduce(([d, p], q) => [d + Math.abs(p.x - q.x) + Math.abs(p.y - q.y), q] as [number, Pt], [0, start] as [number, Pt])[0];
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)];

// ---- Progress, kept in this browser ----
type Progress = { xp: number; steps: number; votes: number; mustSeen: number; coffee: number; duelsWon: number; visited: string[]; done: string[]; gold: string[]; badges: string[]; topics: string[] };
const EMPTY: Progress = { xp: 0, steps: 0, votes: 0, mustSeen: 0, coffee: 0, duelsWon: 0, visited: [], done: [], gold: [], badges: [], topics: [] };
function load(): Progress {
  try {
    return { ...EMPTY, ...JSON.parse(localStorage.getItem(STORE) ?? "{}") };
  } catch {
    return EMPTY;
  }
}
const LEVELS = ["Poster Rookie", "Hall Wanderer", "Board Hunter", "Poster Sage", "Area Chair", "Best Paper Committee"];
const levelOf = (xp: number) => Math.min(LEVELS.length - 1, Math.floor(xp / 100));
const BADGES: { id: string; icon: string; name: string; how: string; got: (p: Progress) => boolean }[] = [
  { id: "first", icon: "👣", name: "First Steps", how: "Visit a poster", got: (p) => p.visited.length >= 1 },
  { id: "must", icon: "💎", name: "Must-read Hunter", how: "Visit 5 must reads", got: (p) => p.mustSeen >= 5 },
  { id: "coffee", icon: "☕", name: "Caffeinated", how: "Grab 5 coffees", got: (p) => p.coffee >= 5 },
  { id: "gold", icon: "🌟", name: "Treasure Hunter", how: "Find a golden poster", got: (p) => p.gold.length >= 1 },
  { id: "critic", icon: "🗳️", name: "Critic", how: "Cast 10 votes", got: (p) => p.votes >= 10 },
  { id: "quest", icon: "🏆", name: "Quest Complete", how: "Finish a session's quest", got: (p) => p.done.length >= 1 },
  { id: "marathon", icon: "🏃", name: "Marathon", how: "Finish 3 sessions", got: (p) => p.done.length >= 3 },
  { id: "duel", icon: "⚔️", name: "Duelist", how: "Win a duel", got: (p) => p.duelsWon >= 1 },
  { id: "globe", icon: "🌏", name: "Globetrotter", how: "Finish quests in 2 cities", got: (p) => new Set(p.done.map((s) => s.split(" ")[0])).size >= 2 },
];

// ---- Sprites: the explorer and the attendees share one body, in different colors ----
const BODY = [
  ["..HHH..", ".HHHHH.", ".FFFFF.", ".FEFEF.", "..FFF..", ".SSSSS.", "FSSSSSF", ".LL.LL.", ".B...B."],
  ["..HHH..", ".HHHHH.", ".FFFFF.", ".FEFEF.", "..FFF..", ".SSSSS.", "FSSSSSF", "..LLL..", "..BB..."],
];
const ME = { H: "#4a2c1a", F: "#f2c39a", E: "#14161a", S: "#d2f54a", L: "#30354d", B: "#14161a" };
const FOLKS = [
  { H: "#14161a", F: "#e0ac82", S: "#e05a5a" }, { H: "#d9b14a", F: "#f2c39a", S: "#33b0dd" },
  { H: "#8a3f2a", F: "#b07850", S: "#c37ad2" }, { H: "#6f7480", F: "#f2c39a", S: "#4fbf4f" }, { H: "#3a2a1a", F: "#8a5a3a", S: "#f4efe2" },
];
const QUIPS = [
  "Reviewer 2 says: needs more baselines.", "Is this SOTA?", "Free coffee somewhere around here ☕", "Has anyone seen the GPUs?",
  "I just came from the oral session.", "My advisor told me to network…", "Scaling is all you need?", "Ablations or it didn't happen.",
  "There's a golden poster in this hall!", "Rebuttal season is over. Finally.",
];

type Other = Pt & { path: Pt[]; nick: string; look: { H: string; F: string; S: string } };
type Chat = { id: string; nick: string; body: string; created_at: string };
const lookFor = (id: string) => {
  const h = idHash(id);
  return { H: ["#14161a", "#4a2c1a", "#d9b14a", "#8a3f2a"][h % 4], F: ["#f2c39a", "#e0ac82", "#b07850", "#8a5a3a"][(h >> 3) % 4], S: SHIRTS[(h >> 5) % SHIRTS.length] };
};
// Attendees you can challenge to a duel; skill is their chance of picking the right poster.
const PERSONAS = [
  { name: "Reviewer 2", skill: 0.8 }, { name: "Sleepy Postdoc", skill: 0.55 }, { name: "Eager Undergrad", skill: 0.45 },
  { name: "Area Chair", skill: 0.75 }, { name: "Hype Bot", skill: 0.35 }, { name: "Senior Prof", skill: 0.7 },
  { name: "Industry Recruiter", skill: 0.5 }, { name: "Lost Tourist", skill: 0.3 },
];
type Npc = Pt & { path: Pt[]; look: (typeof FOLKS)[number]; talkUntil: number; name: string; skill: number };
// Someone on the map you tapped: an attendee bot or another player.
type Target = Pt & { nick: string; id?: string; skill?: number };
type Duel = { id: string; pairs: [string, string][]; opp: Opponent };
type Float = Pt & { text: string; t0: number; color: string };
type Spark = Pt & { vx: number; vy: number; t0: number; color: string };

// ---- 8-bit sounds (square waves), off when muted ----
let audio: AudioContext | null = null;
function beep(notes: number[], step = 0.08, vol = 0.04) {
  try {
    audio ??= new AudioContext();
    const t0 = audio.currentTime;
    notes.forEach((f, i) => {
      const o = audio!.createOscillator(), g = audio!.createGain();
      o.type = "square";
      o.frequency.value = f;
      g.gain.setValueAtTime(vol, t0 + i * step);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + (i + 1) * step);
      o.connect(g).connect(audio!.destination);
      o.start(t0 + i * step);
      o.stop(t0 + (i + 1) * step);
    });
  } catch {}
}
const SFX = {
  tap: [330], arrive: [523, 659, 784], coin: [988, 1319], vote: [660, 880], gold: [523, 659, 784, 1047, 1319, 1568],
  badge: [784, 988, 1175, 1568], win: [523, 523, 523, 659, 784, 659, 784, 1047],
};

export function NeuripsQuest({ city, sessions, session, papers, labels }: {
  city: City; sessions: QuestSession[]; session: QuestSession | null; papers: QuestPaper[]; labels: Record<string, string>;
}) {
  const { session: auth, ready } = useSession();
  const hall = useMemo(() => hallFor(papers.length), [papers.length]);
  const spots = useMemo(() => new Map(papers.map((p) => [p.id, spotOf(p.b, hall)])), [papers, hall]);
  const areas = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of papers) if (p.a) n.set(p.a, (n.get(p.a) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([a]) => a);
  }, [papers]);
  // Today's golden poster: one must read, the same for everyone in this session today.
  const goldKey = `${session?.name}:${new Date().toISOString().slice(0, 10)}`;
  const golden = useMemo(() => {
    const musts = papers.filter((p) => p.tone === 5);
    return musts.length ? musts[hash(goldKey) % musts.length] : null;
  }, [papers, goldKey]);

  const [prog, setProg] = useState<Progress>(EMPTY);
  const [topics, setTopics] = useState<string[]>([]);
  const [quest, setQuest] = useState<QuestPaper[]>([]);
  const [goal, setGoal] = useState<QuestPaper | null>(null);
  const [open, setOpen] = useState<QuestPaper | null>(null);
  const [voted, setVoted] = useState<Record<string, boolean>>({});
  const [toast, setToast] = useState<string | null>(null);
  const [badge, setBadge] = useState<(typeof BADGES)[number] | null>(null);
  const [won, setWon] = useState(false);
  const [muted, setMuted] = useState(false);
  const [bubble, setBubble] = useState<(Pt & { text: string }) | null>(null);
  const [target, setTarget] = useState<Target | null>(null);
  const [duel, setDuel] = useState<Duel | null>(null);
  const [theirs, setTheirs] = useState<Record<number, Answer>>({});
  const [invite, setInvite] = useState<{ id: string; from: string; nick: string; pairs: [string, string][]; skill?: number } | null>(null);
  const [pending, setPending] = useState<{ id: string; nick: string } | null>(null);
  const [result, setResult] = useState<{ mine: number; theirs: number; nick: string } | null>(null);
  const duelRef = useRef<{ duel: Duel | null; pending: { id: string } | null }>({ duel: null, pending: null });
  duelRef.current = { duel, pending };
  const byId = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);
  const walker = useRef({ x: hall.door.x, y: hall.door.y, path: [] as Pt[], walked: 0, goal: null as QuestPaper | null, boostUntil: 0 });
  const world = useRef({ coffees: [] as Pt[], npcs: [] as Npc[], floats: [] as Float[], sparks: [] as Spark[], nextTalk: 0 });
  const others = useRef(new Map<string, Other>());
  const [here, setHere] = useState(1);
  const [chat, setChat] = useState<Chat[]>([]);
  const [draft, setDraft] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const channel = useRef<ReturnType<ReturnType<typeof browserClient>["channel"]> | null>(null);
  // Who I am in the hall: the account for signed-in readers, a random id kept in this browser otherwise.
  const [me, setMe] = useState<{ id: string; nick: string } | null>(null);
  useEffect(() => {
    if (!ready) return;
    let id = auth?.user.id;
    if (!id) {
      try {
        id = localStorage.getItem("gp_quest_id") ?? crypto.randomUUID();
        localStorage.setItem("gp_quest_id", id);
      } catch {
        id = crypto.randomUUID();
      }
    }
    setMe({ id, nick: nickFor(id) });
  }, [ready, auth]);

  const mutedRef = useRef(muted);
  mutedRef.current = muted;
  const sfx = useCallback((k: keyof typeof SFX) => {
    if (!muted) beep(SFX[k], k === "win" ? 0.11 : 0.08);
  }, [muted]);

  // Load progress, topics and the mute switch once; keep topics that exist in this session.
  useEffect(() => {
    const p = load();
    setProg(p);
    const keep = p.topics.filter((t) => areas.includes(t));
    setTopics(keep.length ? keep : areas.slice(0, 2));
    try {
      setMuted(localStorage.getItem(MUTE) === "1");
    } catch {}
  }, [areas]);
  const progRef = useRef(prog);
  progRef.current = prog;
  const save = useCallback((next: Progress) => {
    // Award new badges as they unlock, one banner at a time.
    const fresh = BADGES.filter((b) => !next.badges.includes(b.id) && b.got(next));
    if (fresh.length) {
      next = { ...next, badges: [...next.badges, ...fresh.map((b) => b.id)] };
      setBadge(fresh[0]);
      setTimeout(() => sfx("badge"), 350);
    }
    progRef.current = next;
    setProg(next);
    try {
      localStorage.setItem(STORE, JSON.stringify(next));
    } catch {}
  }, [sfx]);
  const say = (msg: string) => setToast(msg);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  // A fresh hall: the explorer at the door, coffee in the aisles, attendees wandering about.
  const randomStand = useCallback(() => spots.get(pick(papers).id)!.stand, [spots, papers]);
  useEffect(() => {
    walker.current = { x: hall.door.x, y: hall.door.y, path: [], walked: 0, goal: null, boostUntil: 0 };
    if (!papers.length) return;
    world.current = {
      coffees: Array.from({ length: 3 }, () => ({ ...randomStand() })),
      npcs: Array.from({ length: Math.min(8, 3 + Math.round(papers.length / 150)) }, (_, i) => ({ ...randomStand(), path: [], look: FOLKS[i % FOLKS.length], talkUntil: 0, ...{ name: PERSONAS[i % PERSONAS.length].name, skill: PERSONAS[i % PERSONAS.length].skill } })),
      floats: [], sparks: [], nextTalk: performance.now() + 2500,
    };
    setGoal(null);
    setBubble(null);
  }, [hall, papers, randomStand]);

  // Live hall: who else is here and where they're going, plus the chat.
  useEffect(() => {
    if (!session || !me) return;
    const db = browserClient();
    const ch = db.channel(`quest:${session.name}`, { config: { presence: { key: me.id }, broadcast: { self: false } } });
    channel.current = ch;
    const place = (id: string, m: { nick: string; x: number; y: number }) => {
      if (id === me.id) return;
      const o = others.current.get(id);
      if (!o) others.current.set(id, { x: m.x, y: m.y, path: [], nick: m.nick, look: lookFor(m.nick) });
      else if (Math.abs(o.x - m.x) + Math.abs(o.y - m.y) > 1) o.path = route(o, { x: m.x, y: m.y }, hall);
    };
    ch.on("presence", { event: "sync" }, () => {
      const st = ch.presenceState<{ nick: string; x: number; y: number }>();
      for (const id of [...others.current.keys()]) if (!st[id]) others.current.delete(id);
      for (const [id, metas] of Object.entries(st)) if (metas[0]) place(id, metas[0]);
      setHere(Math.max(1, Object.keys(st).length));
    });
    ch.on("broadcast", { event: "move" }, ({ payload }) => place(payload.id, payload));
    ch.on("broadcast", { event: "chat" }, ({ payload }) => {
      const m = payload as Chat & { pid: string };
      setChat((c) => (c.some((x) => x.id === m.id) ? c : [...c, m].slice(-60)));
      const o = others.current.get(m.pid);
      if (o) {
        setBubble({ x: o.x, y: o.y - 11, text: m.body });
        setTimeout(() => setBubble((b) => (b?.text === m.body ? null : b)), 4000);
      }
    });
    // Duels: invites, answers and replies addressed to me.
    ch.on("broadcast", { event: "duel" }, ({ payload }) => {
      const m = payload as { kind: string; to: string; id: string; from: string; nick: string; pairs?: [string, string][]; round?: number; answer?: Answer };
      if (m.to !== me.id) return;
      const cur = duelRef.current;
      if (m.kind === "invite") {
        if (cur.duel || cur.pending) return void ch.send({ type: "broadcast", event: "duel", payload: { kind: "busy", to: m.from, id: m.id, from: me.id, nick: me.nick } });
        setInvite({ id: m.id, from: m.from, nick: m.nick, pairs: m.pairs ?? [] });
        if (!mutedRef.current) beep(SFX.badge);
      } else if (m.kind === "accept" && cur.pending?.id === m.id) {
        setPending(null);
        setTheirs({});
        setDuel({ id: m.id, pairs: m.pairs ?? [], opp: { nick: m.nick, id: m.from } });
      } else if ((m.kind === "decline" || m.kind === "busy") && cur.pending?.id === m.id) {
        setPending(null);
        setToast(m.kind === "busy" ? `${m.nick.toUpperCase()} IS BUSY` : `${m.nick.toUpperCase()} DECLINED`);
      } else if (m.kind === "answer" && cur.duel?.id === m.id && m.answer) {
        setTheirs((t) => ({ ...t, [m.round!]: m.answer! }));
      }
    });
    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") ch.track({ nick: me.nick, x: walker.current.x, y: walker.current.y });
    });
    fetch(`/api/quest-chat?s=${encodeURIComponent(session.name)}`)
      .then((r) => (r.ok ? r.json() : { messages: [] }))
      .then((j: { messages: Chat[] }) => setChat(j.messages ?? []))
      .catch(() => {});
    return () => {
      others.current.clear();
      channel.current = null;
      db.removeChannel(ch);
    };
  }, [session, me, hall]);
  // Tell the hall where I'm headed (only when that changes, so it stays cheap).
  const announce = useCallback((to: Pt) => {
    const ch = channel.current;
    if (!ch || !me) return;
    ch.send({ type: "broadcast", event: "move", payload: { id: me.id, nick: me.nick, x: to.x, y: to.y } });
    ch.track({ nick: me.nick, x: to.x, y: to.y });
  }, [me]);
  async function sendChat(e: React.FormEvent) {
    e.preventDefault();
    if (!auth || !session) return signIn();
    const body = draft.trim();
    if (!body) return;
    setChatError(null);
    const r = await fetch("/api/quest-chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${auth.access_token}` },
      body: JSON.stringify({ s: session.name, body }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setChatError(j.error ?? "Your message wasn't sent.");
    setDraft("");
    setChat((c) => [...c, j.message].slice(-60));
    channel.current?.send({ type: "broadcast", event: "chat", payload: { ...j.message, pid: me?.id } });
    const w = walker.current;
    setBubble({ x: w.x, y: w.y - 11, text: body });
    setTimeout(() => setBubble((b) => (b?.text === body ? null : b)), 4000);
    sfx("tap");
  }

  // ---- Duels ----
  function challenge(t: Target) {
    setTarget(null);
    const pairs = makePairs(papers);
    if (pairs.length < 3) return say("NOT ENOUGH RATED POSTERS HERE");
    if (t.skill !== undefined) { // an attendee: play right away
      setTheirs({});
      setDuel({ id: crypto.randomUUID(), pairs, opp: { nick: t.nick, skill: t.skill } });
      return sfx("badge");
    }
    if (!me || !t.id || !channel.current) return;
    const id = crypto.randomUUID();
    setPending({ id, nick: t.nick });
    channel.current.send({ type: "broadcast", event: "duel", payload: { kind: "invite", to: t.id, id, from: me.id, nick: me.nick, pairs } });
    setTimeout(() => setPending((p) => {
      if (p?.id !== id) return p;
      setToast("NO ANSWER. TRY SOMEONE ELSE");
      return null;
    }), 20000);
  }
  function answerInvite(ok: boolean) {
    if (!invite) return;
    if (invite.skill !== undefined) { // an attendee's challenge: no one to tell
      if (ok) {
        setTheirs({});
        setDuel({ id: invite.id, pairs: invite.pairs, opp: { nick: invite.nick, skill: invite.skill } });
      }
      return setInvite(null);
    }
    if (!me) return;
    channel.current?.send({ type: "broadcast", event: "duel", payload: { kind: ok ? "accept" : "decline", to: invite.from, id: invite.id, from: me.id, nick: me.nick, pairs: invite.pairs } });
    if (ok) {
      setTheirs({});
      setDuel({ id: invite.id, pairs: invite.pairs, opp: { nick: invite.nick, id: invite.from } });
    }
    setInvite(null);
  }
  // Soon after you walk in, an attendee comes over and challenges you, once per visit, so
  // everyone finds out duels exist.
  useEffect(() => {
    if (!papers.length) return;
    const t = setTimeout(() => {
      const d = duelRef.current;
      const n = world.current.npcs[0];
      if (d.duel || d.pending || !n) return;
      const pairs = makePairs(papers);
      if (pairs.length < 3) return;
      n.talkUntil = performance.now() + 5000;
      setBubble({ x: n.x, y: n.y - 11, text: "Hey! Bet I can spot the better poster faster than you." });
      setTimeout(() => setBubble(null), 5000);
      setInvite((cur) => cur ?? { id: crypto.randomUUID(), from: "attendee", nick: n.name, pairs, skill: n.skill });
      if (!mutedRef.current) beep(SFX.badge);
    }, 9000 + Math.random() * 6000);
    return () => clearTimeout(t);
  }, [papers]);
  function duelOver(mine: number, theirs: number) {
    const opp = duel?.opp;
    setDuel(null);
    if (!opp) return;
    const win = mine > theirs, draw = mine === theirs;
    const cur = progRef.current;
    save({ ...cur, xp: cur.xp + (win ? 30 : draw ? 15 : 5), duelsWon: cur.duelsWon + (win ? 1 : 0) });
    setResult({ mine, theirs, nick: opp.nick });
    sfx(win ? "win" : "tap");
  }

  // The quest: the best posters in the chosen topics, in walking order from the door.
  useEffect(() => {
    const pool = papers.filter((p) => !topics.length || (p.a && topics.includes(p.a))).sort((a, b) => b.pct - a.pct).slice(0, QUEST_SIZE);
    const out: QuestPaper[] = [];
    let at: Pt = hall.door;
    const left = [...pool];
    while (left.length) {
      left.sort((a, b) => pathLen(route(at, spots.get(a.id)!.stand, hall), at) - pathLen(route(at, spots.get(b.id)!.stand, hall), at));
      const p = left.shift()!;
      out.push(p);
      at = spots.get(p.id)!.stand;
    }
    setQuest(out);
  }, [topics, papers, hall, spots]);

  function toggleTopic(a: string) {
    const next = topics.includes(a) ? topics.filter((t) => t !== a) : [...topics, a];
    setTopics(next);
    save({ ...progRef.current, topics: next });
  }

  const visited = new Set(prog.visited);
  const remaining = quest.filter((p) => !visited.has(p.id));
  function goTo(p: QuestPaper) {
    const w = walker.current;
    w.goal = p;
    w.path = route({ x: w.x, y: w.y }, spots.get(p.id)!.stand, hall);
    announce(spots.get(p.id)!.stand);
    setGoal(p);
    setOpen(null);
    sfx("tap");
  }
  function nextStop() {
    if (walker.current.path.length) return say("ON MY WAY…");
    const next = remaining[0];
    if (next) goTo(next);
    else say("ALL QUEST POSTERS VISITED ★");
  }

  // Arriving at a poster counts as a visit: XP, sparkles, and the poster card.
  const arrive = useCallback(
    (p: QuestPaper) => {
      setOpen(p);
      setGoal(null);
      const s = spots.get(p.id)!, now = performance.now(), wd = world.current;
      const isGold = golden?.id === p.id && !progRef.current.gold.includes(goldKey);
      for (let i = 0; i < (isGold ? 28 : 12); i++) {
        wd.sparks.push({ x: s.x + 2, y: s.y + 2, vx: (Math.random() - 0.5) * 60, vy: -20 - Math.random() * 50, t0: now, color: pick(isGold ? ["#ffcc33", "#fff6c2", "#ffffff"] : ["#d2f54a", "#ffcc33", "#33b0dd"]) });
      }
      const cur = progRef.current;
      if (isGold) {
        wd.floats.push({ x: s.x, y: s.y - 4, text: "+50 GOLD!", t0: now, color: "#ffcc33" });
        save({ ...cur, xp: cur.xp + 50, gold: [...cur.gold, goldKey] });
        sfx("gold");
        say("🌟 YOU FOUND THE GOLDEN POSTER!");
        return;
      }
      if (cur.visited.includes(p.id)) return sfx("tap");
      const must = p.tone === 5;
      const gain = 10 + (must ? 5 : 0);
      wd.floats.push({ x: s.x, y: s.y - 4, text: `+${gain}`, t0: now, color: "#d2f54a" });
      save({ ...cur, xp: cur.xp + gain, visited: [...cur.visited, p.id], mustSeen: cur.mustSeen + (must ? 1 : 0), steps: cur.steps + Math.round(walker.current.walked / 3) });
      walker.current.walked = 0;
      sfx("arrive");
    },
    [save, sfx, spots, golden, goldKey],
  );
  const grabCoffee = useCallback(
    (c: Pt) => {
      const wd = world.current, w = walker.current, now = performance.now();
      wd.coffees = wd.coffees.filter((x) => x !== c);
      setTimeout(() => wd.coffees.push({ ...randomStand() }), 4000);
      w.boostUntil = now + 6000;
      wd.floats.push({ x: c.x - 6, y: c.y - 10, text: "+5 ☕", t0: now, color: "#f4efe2" });
      const cur = progRef.current;
      save({ ...cur, xp: cur.xp + 5, coffee: cur.coffee + 1 });
      sfx("coin");
      say("☕ CAFFEINE! SPEED UP");
    },
    [save, sfx, randomStand],
  );

  // Quest complete once every poster on it has been visited.
  useEffect(() => {
    if (!session || !quest.length || quest.some((p) => !visited.has(p.id)) || prog.done.includes(session.name)) return;
    setWon(true);
    setTimeout(() => sfx("win"), 600);
    save({ ...progRef.current, xp: progRef.current.xp + 50, done: [...progRef.current.done, session.name] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prog.visited, quest]);

  async function vote(p: QuestPaper, up: boolean) {
    if (!auth) return say("SIGN IN SO YOUR VOTE COUNTS");
    const db = browserClient();
    const { error } = await db.from("ratings").upsert({ user_id: auth.user.id, paper_id: p.id, worth_reading: up }, { onConflict: "user_id,paper_id" });
    if (error) return say("VOTE NOT SAVED, TRY AGAIN");
    await setMyVote(auth.user.id, p.id, up);
    window.dispatchEvent(new CustomEvent("gp-voted", { detail: { id: p.id, prev: undefined, next: up } }));
    fetch("/api/voted", { method: "POST" }).catch(() => {});
    if (voted[p.id] === undefined) save({ ...progRef.current, xp: progRef.current.xp + 5, votes: progRef.current.votes + 1 });
    setVoted((v) => ({ ...v, [p.id]: up }));
    sfx("vote");
    say(up ? "+5 XP · VOTE CAST ♥" : "+5 XP · VOTE CAST");
  }

  // ---- The game loop ----
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ quest, visited, open, arrive, grabCoffee, golden, goldFound: prog.gold.includes(goldKey) });
  live.current = { quest, visited, open, arrive, grabCoffee, golden, goldFound: prog.gold.includes(goldKey) };
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const g = cv.getContext("2d")!;
    let raf = 0, last = performance.now();
    const step = (o: Pt & { path: Pt[] }, v: number) => {
      const b = o.path[0], dx = b.x - o.x, dy = b.y - o.y, d = Math.hypot(dx, dy);
      if (d <= v) { o.x = b.x; o.y = b.y; o.path.shift(); return d; }
      o.x += (dx / d) * v; o.y += (dy / d) * v;
      return v;
    };
    const sprite = (x: number, y: number, f: number, c: Record<string, string>) =>
      BODY[f].forEach((row, j) => [...row].forEach((ch, i) => {
        if (ch === ".") return;
        g.fillStyle = c[ch] ?? ME[ch as keyof typeof ME];
        g.fillRect(Math.round(x) - 3 + i, Math.round(y) - 9 + j, 1, 1);
      }));
    const frame = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      const { quest, visited, open, golden, goldFound } = live.current;
      const wd = world.current, w = walker.current;
      const qIds = new Set(quest.map((p) => p.id));
      // floor, walls, entrance
      for (let y = 0; y < hall.h; y += 8) for (let x = 0; x < hall.w; x += 8) {
        g.fillStyle = ((x + y) / 8) % 2 ? "#2b2f45" : "#2f344c";
        g.fillRect(x, y, 8, 8);
      }
      g.fillStyle = "#11131d";
      g.fillRect(0, 0, hall.w, 4); g.fillRect(0, 0, 4, hall.h); g.fillRect(hall.w - 4, 0, 4, hall.h); g.fillRect(0, hall.h - 4, hall.w, 4);
      g.fillStyle = "#d2f54a";
      g.fillRect(hall.door.x - 10, hall.h - 4, 20, 4);
      g.font = "8px 'Press Start 2P', monospace";
      g.fillStyle = "#f4efe2";
      g.fillText((session?.room ?? "HALL").toUpperCase(), 9, 17);
      g.fillText("ENTRANCE", hall.door.x - 31, hall.h - 9);
      // islands and boards
      for (let i = 0; i < hall.islands; i++) {
        const ix = X0 + AISLE + i * (ISL_W + AISLE);
        g.fillStyle = "#11131d";
        g.fillRect(ix - 1, Y0 - 1, ISL_W + 2, hall.per * CELL_H + 1);
        g.fillStyle = "#4a3a2c";
        g.fillRect(ix + BOARD_W, Y0, ISL_W - 2 * BOARD_W, hall.per * CELL_H - 1);
      }
      const pulse = Math.floor(t / 300) % 2;
      for (const p of papers) {
        const s = spots.get(p.id)!;
        const seen = visited.has(p.id), inQ = qIds.has(p.id), gold = golden?.id === p.id && !goldFound;
        g.fillStyle = gold ? (Math.floor(t / 160) % 2 ? "#ffcc33" : "#fff6c2") : seen ? "#8b8fa0" : inQ ? (pulse ? "#ffcc33" : "#ffe28a") : p.tone === 5 ? "#3f7a46" : "#4a4f66";
        g.fillRect(s.x, s.y, BOARD_W, CELL_H - 2);
        if (gold) { // twinkles around the golden poster
          g.fillStyle = "#fff6c2";
          const k = Math.floor(t / 200) % 4;
          g.fillRect(s.x + [-2, 5, 6, -3][k], s.y + [-2, -1, 4, 5][k], 1, 1);
        } else if (inQ && !seen) { // star flag over each quest poster
          const fx = s.face ? s.x + BOARD_W + 1 : s.x - 4;
          g.fillStyle = "#ffcc33";
          g.fillRect(fx + 1, s.y - 2, 1, 1); g.fillRect(fx, s.y - 1, 3, 1); g.fillRect(fx + 1, s.y, 1, 1);
        }
        if (open?.id === p.id || w.goal?.id === p.id) {
          g.strokeStyle = "#ffffff";
          g.lineWidth = 1;
          g.strokeRect(s.x - 0.5, s.y - 0.5, BOARD_W + 1, CELL_H - 1);
        }
      }
      // coffee cups with a wisp of steam
      for (const c of wd.coffees) {
        g.fillStyle = "#f4efe2"; g.fillRect(c.x - 2, c.y - 3, 4, 4);
        g.fillStyle = "#6b3e1e"; g.fillRect(c.x - 1, c.y - 3, 2, 1);
        g.fillStyle = "#f4efe2"; g.fillRect(c.x + 2, c.y - 2, 1, 2);
        g.fillStyle = "rgba(244,239,226,.6)"; g.fillRect(c.x - 1 + (Math.floor(t / 250) % 2), c.y - 6, 1, 2);
      }
      // the route ahead, as dots
      if (w.path.length) {
        g.fillStyle = "#ffcc33";
        let a: Pt = { x: w.x, y: w.y };
        for (const b of w.path) {
          const n = Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
          for (let k = 0; k < n; k += 3) g.fillRect(Math.round(a.x + ((b.x - a.x) * k) / n), Math.round(a.y + ((b.y - a.y) * k) / n), 1, 1);
          a = b;
        }
      }
      // attendees wander between posters; now and then one says something
      for (const n of wd.npcs) {
        if (n.talkUntil < t) {
          if (!n.path.length) n.path = route(n, randomStand(), hall);
          step(n, 28 * dt);
        }
        sprite(n.x, n.y, n.path.length && n.talkUntil < t ? Math.floor(t / 180) % 2 : 0, n.look);
      }
      if (t > wd.nextTalk && wd.npcs.length) {
        const n = pick(wd.npcs);
        const hint = quest.find((p) => !visited.has(p.id));
        const line = hint && Math.random() < 0.5 ? `Board #${hint.b} is a ${hint.tier.toLowerCase()}! Go see it.` : pick(QUIPS);
        n.talkUntil = t + 3500;
        wd.nextTalk = t + 6000 + Math.random() * 4000;
        setBubble({ x: n.x, y: n.y - 11, text: line });
        setTimeout(() => setBubble((b) => (b?.text === line ? null : b)), 3500);
      }
      // other players, with their nicknames
      g.font = "10px VT323, monospace";
      for (const o of others.current.values()) {
        if (o.path.length) step(o, 120 * dt);
        sprite(o.x, o.y, o.path.length ? Math.floor(t / 120) % 2 : 0, o.look);
        const tw = g.measureText(o.nick).width;
        g.fillStyle = "rgba(17,19,29,.75)";
        g.fillRect(Math.round(o.x - tw / 2) - 1, Math.round(o.y) - 18, Math.ceil(tw) + 2, 8);
        g.fillStyle = o.look.S;
        g.fillText(o.nick, Math.round(o.x - tw / 2), Math.round(o.y) - 11);
      }
      // the explorer
      if (w.path.length) {
        const v = (w.boostUntil > t ? 210 : 120) * dt;
        w.walked += step(w, v);
        if (!w.path.length) {
          const goal = w.goal;
          w.goal = null;
          if (goal) live.current.arrive(goal);
        }
      }
      for (const c of wd.coffees) if (Math.abs(c.x - w.x) < 4 && Math.abs(c.y - w.y) < 5) { live.current.grabCoffee(c); break; }
      if (w.boostUntil > t) { // speed lines
        g.fillStyle = "rgba(210,245,74,.7)";
        g.fillRect(Math.round(w.x) - 6, Math.round(w.y) - 5, 2, 1);
        g.fillRect(Math.round(w.x) - 7, Math.round(w.y) - 2, 3, 1);
      }
      sprite(w.x, w.y, w.path.length ? Math.floor(t / 120) % 2 : 0, ME);
      // sparkles and floating XP
      wd.sparks = wd.sparks.filter((s) => t - s.t0 < 700);
      for (const s of wd.sparks) {
        const k = (t - s.t0) / 1000;
        g.fillStyle = s.color;
        g.fillRect(Math.round(s.x + s.vx * k), Math.round(s.y + s.vy * k + 60 * k * k), 1, 1);
      }
      wd.floats = wd.floats.filter((f) => t - f.t0 < 1100);
      g.font = "8px 'Press Start 2P', monospace";
      for (const f of wd.floats) {
        const k = (t - f.t0) / 1100;
        g.fillStyle = "#11131d";
        g.fillText(f.text, f.x + 1, f.y - k * 14 + 1);
        g.fillStyle = f.color;
        g.fillText(f.text, f.x, f.y - k * 14);
      }
      raf = requestAnimationFrame(frame);
    };
    document.fonts.ready.then(() => (raf = requestAnimationFrame(frame)));
    return () => cancelAnimationFrame(raf);
  }, [hall, papers, spots, session, randomStand]);

  // Tap a poster to walk to it, an attendee to hear them out, or a coffee to grab it.
  function clickMap(e: React.MouseEvent<HTMLCanvasElement>) {
    const cv = canvas.current!;
    const r = cv.getBoundingClientRect(), k = cv.width / r.width;
    const x = (e.clientX - r.left) * k, y = (e.clientY - r.top) * k;
    const wd = world.current, w = walker.current;
    const npc = wd.npcs.find((n) => Math.abs(n.x - x) < 5 && y > n.y - 11 && y < n.y + 2);
    if (npc) {
      npc.talkUntil = performance.now() + 6000;
      setBubble(null);
      setTarget({ x: npc.x, y: npc.y - 11, nick: npc.name, skill: npc.skill });
      return sfx("tap");
    }
    const player = [...others.current.entries()].find(([, o]) => Math.abs(o.x - x) < 5 && y > o.y - 18 && y < o.y + 2);
    if (player) {
      setTarget({ x: player[1].x, y: player[1].y - 18, nick: player[1].nick, id: player[0] });
      return sfx("tap");
    }
    setTarget(null);
    const cup = wd.coffees.find((c) => Math.abs(c.x - x) < 5 && Math.abs(c.y - y) < 6);
    if (cup) {
      w.goal = null;
      w.path = route({ x: w.x, y: w.y }, cup, hall);
      announce(cup);
      return sfx("tap");
    }
    const hit = papers.find((p) => {
      const s = spots.get(p.id)!;
      return x >= s.x - 2 && x <= s.x + BOARD_W + 2 && y >= s.y - 1.5 && y <= s.y + CELL_H;
    });
    if (hit) goTo(hit);
  }
  function addToQuest(p: QuestPaper) {
    setQuest((q) => (q.some((x) => x.id === p.id) ? q.filter((x) => x.id !== p.id) : [...q, p]));
  }
  function toggleMute() {
    setMuted((m) => {
      try {
        localStorage.setItem(MUTE, m ? "0" : "1");
      } catch {}
      return !m;
    });
  }

  const lvl = levelOf(prog.xp);
  const share = session
    ? `🎮 NeurIPS Quest · ${session.name.replace(" Poster Session ", " S")} · ${quest.length}/${quest.length} posters ★ · Lv.${lvl + 1} ${LEVELS[lvl]} · goodpapers.org/neurips/quest`
    : "";
  const tz = session ? ZONES[session.city] : "UTC";
  const when = (iso: string | null, o: Intl.DateTimeFormatOptions) => (iso ? new Intl.DateTimeFormat("en-US", { timeZone: tz, ...o }).format(new Date(iso)) : "");

  return (
    <main className="quest">
      <div className="quest-wrap">
        <header className="quest-head">
          <div>
            <p className="quest-crumb"><Link href="/neurips">← NeurIPS 2026</Link></p>
            <h1>NEURIPS QUEST</h1>
            <p className="quest-sub">Tap any poster to walk there. Find the golden one. Grab the coffee.</p>
          </div>
          <div className="quest-player">
            <b>LV.{lvl + 1} {LEVELS[lvl].toUpperCase()}</b>
            <span className="quest-xp"><i style={{ width: `${prog.xp % 100}%` }} /></span>
            <small>{prog.xp} XP · {prog.steps} STEPS · {prog.badges.length}/{BADGES.length} BADGES</small>
          </div>
        </header>

        <nav className="quest-tabs" aria-label="City">
          {CITY_LIST.map((c) => (
            <Link key={c} href={`/neurips/quest?city=${c}`} aria-current={c === city ? "page" : undefined}>{c.toUpperCase()}</Link>
          ))}
        </nav>
        <nav className="quest-sessions" aria-label="Poster session">
          {sessions.filter((s) => s.city === city).map((s) => (
            <Link key={s.name} href={`/neurips/quest?s=${encodeURIComponent(s.name)}`} aria-current={s.name === session?.name ? "page" : undefined}>
              <b>S{s.name.split(" ").pop()}{prog.done.includes(s.name) ? " ★" : ""}</b>
              <small>{new Intl.DateTimeFormat("en-US", { timeZone: ZONES[s.city], weekday: "short", hour: "numeric" }).format(new Date(s.start ?? 0))}</small>
            </Link>
          ))}
        </nav>

        {!session ? (
          <p className="quest-empty">No poster sessions here yet.</p>
        ) : (
          <>
            <p className="quest-when">
              ● {when(session.start, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}–
              {when(session.end, { hour: "numeric", minute: "2-digit" })} {session.city} time · {session.room} · {papers.length} posters
            </p>
            <div className="quest-chips" aria-label="Topics">
              {areas.map((a) => (
                <button key={a} aria-pressed={topics.includes(a)} onClick={() => toggleTopic(a)}>{labels[a] ?? a}</button>
              ))}
            </div>

            <div className="quest-game">
              <div>
                <div className="quest-screen">
                  <canvas ref={canvas} width={hall.w} height={hall.h} onClick={clickMap} aria-label={`Map of ${session.room}`} />
                  {target && (
                    <div className="quest-bubble quest-target" style={{ left: `${Math.min(80, Math.max(20, (target.x / hall.w) * 100))}%`, top: `${(target.y / hall.h) * 100}%` }}>
                      <b>{target.nick}</b>
                      {target.skill !== undefined ? <small>Attendee · skill {Math.round(target.skill * 10)}/10</small> : <small>Player</small>}
                      <span className="quest-row">
                        <button className="quest-btn" onClick={() => challenge(target)}>⚔️ CHALLENGE</button>
                        <button className="quest-btn alt" onClick={() => setTarget(null)}>✕</button>
                      </span>
                    </div>
                  )}
                  {bubble && (
                    <div className="quest-bubble" style={{ left: `${Math.min(80, Math.max(20, (bubble.x / hall.w) * 100))}%`, top: `${(bubble.y / hall.h) * 100}%` }}>
                      {bubble.text}
                    </div>
                  )}
                </div>
                <div className="quest-hud">
                  <button className="quest-btn" onClick={nextStop}>{prog.visited.some((id) => quest.some((q) => q.id === id)) ? "NEXT QUEST POSTER ›" : "▶ START QUEST"}</button>
                  <span className="quest-count">{quest.length - remaining.length}/{quest.length} QUEST</span>
                  <span className="quest-count quest-here" title={me ? `You are ${me.nick}` : undefined}>👥 {here} HERE</span>
                  <button className="quest-btn alt quest-mute" onClick={toggleMute} aria-label={muted ? "Sound on" : "Sound off"}>{muted ? "🔇" : "🔊"}</button>
                </div>
                <div className="quest-legend">
                  <span><i style={{ background: "#ffcc33" }} />Your quest</span>
                  <span><i style={{ background: "#fff6c2" }} />Golden poster (+50)</span>
                  <span><i style={{ background: "#3f7a46" }} />Must reads</span>
                  <span><i style={{ background: "#8b8fa0" }} />Visited</span>
                  <span>☕ Coffee: speed boost</span>
                </div>
                {open && (
                  <div className="quest-card" role="dialog" aria-label={open.t}>
                    <div className="quest-card-top">
                      <span className="quest-board">BOARD #{open.b}</span>
                      <span className="quest-tier" style={{ background: TONES[open.tone] }}>
                        {open.tier.toUpperCase()}{voted[open.id] !== undefined ? ` ${open.pct}%` : ""}
                      </span>
                      <button className="quest-x" onClick={() => setOpen(null)} aria-label="Close">✕</button>
                    </div>
                    <h3>{open.t}</h3>
                    <p className="quest-meta">{open.au.join(", ")}{open.au.length >= 3 ? " et al." : ""}</p>
                    <div className="quest-row">
                      <button className="quest-btn" onClick={() => vote(open, true)} aria-pressed={voted[open.id] === true}>♥ WORTH IT</button>
                      <button className="quest-btn alt" onClick={() => vote(open, false)} aria-pressed={voted[open.id] === false}>✕ NOPE</button>
                      <button className="quest-btn alt" onClick={() => addToQuest(open)}>{quest.some((q) => q.id === open.id) ? "− QUEST" : "+ QUEST"}</button>
                      <Link className="quest-btn alt" href={`/paper/${open.id}`}>PAPER →</Link>
                    </div>
                    {!auth && (
                      <p className="quest-meta">
                        <button className="quest-link" onClick={() => signIn()}>Sign in</button> so your votes count and earn XP.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <aside className="quest-side">
                <h2>YOUR QUEST · {quest.length - remaining.length}/{quest.length}</h2>
                <ol className="quest-list">
                  {quest.map((p) => (
                    <li key={p.id} className={`${visited.has(p.id) ? "done" : ""} ${goal?.id === p.id ? "here" : ""}`} onClick={() => goTo(p)}>
                      <span className="quest-board">#{p.b}</span>
                      <div>
                        <div className="quest-title">{p.t}</div>
                        <div className="quest-meta">{(p.a && labels[p.a]) || ""}</div>
                      </div>
                      <span className="quest-tier" style={{ background: TONES[p.tone] }}>{p.tier.toUpperCase()}</span>
                    </li>
                  ))}
                </ol>
                <h2 className="quest-badges-h">HALL CHAT</h2>
                <div className="quest-chat">
                  <ol className="quest-chat-list" aria-live="polite">
                    {chat.length === 0 && <li className="quest-meta">No messages yet. Say hi 👋</li>}
                    {chat.map((m) => (
                      <li key={m.id}>
                        <b style={{ color: lookFor(m.nick).S }}>{m.nick}</b> {m.body}
                      </li>
                    ))}
                  </ol>
                  {auth ? (
                    <form onSubmit={sendChat} className="quest-chat-form">
                      <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={280} placeholder="Which poster is worth it?" aria-label="Message" />
                      <button className="quest-btn">SEND</button>
                    </form>
                  ) : (
                    <p className="quest-meta"><button className="quest-link" onClick={() => signIn()}>Sign in</button> to chat. You show up as {me?.nick ?? "a nickname"}, never your real name.</p>
                  )}
                  {chatError && <p className="quest-meta">{chatError}</p>}
                </div>
                <h2 className="quest-badges-h">BADGES</h2>
                <ul className="quest-badges">
                  {BADGES.map((b) => (
                    <li key={b.id} className={prog.badges.includes(b.id) ? "got" : ""} title={b.how}>
                      <span>{b.icon}</span>
                      <b>{b.name}</b>
                      <small>{b.how}</small>
                    </li>
                  ))}
                </ul>
              </aside>
            </div>
            <p className="quest-note">Board numbers are placeholders until NeurIPS publishes the real ones. Progress and badges are kept in this browser.</p>
          </>
        )}
      </div>

      {toast && <div className="quest-toast" role="status">{toast}</div>}
      {badge && (
        <div className="quest-modal" role="dialog" aria-label="Badge unlocked" onClick={() => setBadge(null)}>
          <div className="quest-modal-box">
            <p className="quest-kicker">BADGE UNLOCKED!</p>
            <div className="quest-big">{badge.icon}</div>
            <h3>{badge.name.toUpperCase()}</h3>
            <p className="quest-meta">{badge.how}</p>
            <button className="quest-btn">OK</button>
          </div>
        </div>
      )}
      {duel && (
        <QuestDuel
          key={duel.id}
          papers={byId}
          pairs={duel.pairs}
          opp={duel.opp}
          theirs={theirs}
          onAnswer={(round, answer) => {
            if (duel.opp.id && me) channel.current?.send({ type: "broadcast", event: "duel", payload: { kind: "answer", to: duel.opp.id, id: duel.id, from: me.id, nick: me.nick, round, answer } });
          }}
          onDone={duelOver}
          sfx={sfx}
        />
      )}
      {invite && !duel && (
        <div className="quest-modal" role="dialog" aria-label="Duel invite">
          <div className="quest-modal-box">
            <p className="quest-kicker">⚔️ CHALLENGE!</p>
            <h3>{invite.nick.toUpperCase()} WANTS TO DUEL</h3>
            {invite.skill !== undefined && <p className="quest-meta">An attendee · skill {Math.round(invite.skill * 10)}/10. Tap anyone on the map to challenge them yourself.</p>}
            <p className="quest-meta">5 rounds: which poster did readers rate higher? 10 seconds each.</p>
            <div className="quest-row">
              <button className="quest-btn" onClick={() => answerInvite(true)}>ACCEPT</button>
              <button className="quest-btn alt" onClick={() => answerInvite(false)}>NOT NOW</button>
            </div>
          </div>
        </div>
      )}
      {pending && <div className="quest-toast" role="status">WAITING FOR {pending.nick.toUpperCase()}…</div>}
      {result && !duel && !badge && (
        <div className="quest-modal" role="dialog" aria-label="Duel result">
          <div className="quest-modal-box">
            <p className="quest-kicker">{result.mine > result.theirs ? "YOU WIN!" : result.mine === result.theirs ? "DRAW!" : "YOU LOSE…"}</p>
            <div className="quest-big">{result.mine > result.theirs ? "🏆" : result.mine === result.theirs ? "🤝" : "💀"}</div>
            <h3>{result.mine} – {result.theirs} vs {result.nick.toUpperCase()}</h3>
            <p className="quest-meta">+{result.mine > result.theirs ? 30 : result.mine === result.theirs ? 15 : 5} XP</p>
            <div className="quest-row">
              <button className="quest-btn" onClick={() => setResult(null)}>OK</button>
            </div>
          </div>
        </div>
      )}
      {won && !badge && session && (
        <div className="quest-modal" role="dialog" aria-label="Quest complete">
          <div className="quest-modal-box">
            <p className="quest-kicker">QUEST COMPLETE!</p>
            <div className="quest-big">★</div>
            <h3>{session.name.toUpperCase()}</h3>
            <p className="quest-meta">{quest.length} posters · +50 XP bonus · Lv.{lvl + 1} {LEVELS[lvl]}</p>
            <div className="quest-row">
              <button className="quest-btn" onClick={() => { navigator.clipboard?.writeText(share).catch(() => {}); say("COPIED! SHARE IT"); }}>COPY RESULT</button>
              <button className="quest-btn alt" onClick={() => setWon(false)}>KEEP EXPLORING</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
