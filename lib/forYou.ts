// "For you": what's hot right now, tilted toward the topics a reader follows. Each paper
// is ranked by timeliness (Hugging Face upvotes, discussion, how new it is), how well it
// matches the reader's topics and venues (the ones they picked, refined by what they vote
// on, comment on and read), and its score. Papers they've voted on are left out.
// Takes a Supabase client so the browser (RLS) and the server (agents) share it.
import type { SupabaseClient } from "@supabase/supabase-js";
import { AREA_GROUPS, AREAS } from "./areas";
import type { Score } from "./types";

export type Prefs = { areas: string[]; venues: string[]; name: string | null; institution: string | null };

const DAYS = 21; // "right now"
const SIMILAR_DAYS = 45; // how far back papers close to what you read can come from

// Area keys to query: a followed group means every area in it.
export function areaKeys(areas: string[]): string[] {
  return [...new Set(areas.flatMap((a) => (AREA_GROUPS[a] ? Object.keys(AREA_GROUPS[a].areas) : [a])))];
}

export async function loadPrefs(db: SupabaseClient, uid: string): Promise<Prefs | null> {
  const { data } = await db.from("reader_prefs").select("areas, venues, name, institution").eq("user_id", uid).maybeSingle();
  return (data as Prefs | null) ?? null;
}

async function votedOn(db: SupabaseClient, uid: string): Promise<Set<string>> {
  const { data } = await db.from("ratings").select("paper_id").eq("user_id", uid).limit(5000);
  return new Set((data ?? []).map((r) => r.paper_id as string));
}

// What a reader's own activity says about their interests, area by area: votes, comments
// and reading time on paper pages (reader_views), newer activity counting more.
const HALF_LIFE_DAYS = 30;
const WINDOW_DAYS = 120;

export type Affinity = {
  area: Map<string, number>; // -1..1
  group: Map<string, number>; // -1..1
  papers: Map<string, number>; // net weight per paper, for the embedding match (similar_papers)
};

export async function learnedAffinity(db: SupabaseClient, uid: string): Promise<Affinity> {
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const [votes, comments, views] = await Promise.all([
    db.from("ratings").select("paper_id, worth_reading, updated_at").eq("user_id", uid).gte("updated_at", since).limit(1000),
    db.from("comments").select("paper_id, created_at").eq("user_id", uid).gte("created_at", since).limit(1000),
    db.from("reader_views").select("paper_id, seconds, day").eq("user_id", uid).gte("day", since.slice(0, 10)).limit(2000),
  ]);
  const decay = (iso: string) => Math.pow(0.5, (Date.now() - Date.parse(iso)) / 86400_000 / HALF_LIFE_DAYS);
  const signals: { paper: string; w: number }[] = [];
  // Votes are one tap, so they count less than reading time or a comment.
  for (const v of votes.data ?? []) signals.push({ paper: v.paper_id, w: (v.worth_reading === true ? 0.3 : v.worth_reading === false ? -0.2 : 0.1) * decay(v.updated_at) });
  for (const c of comments.data ?? []) signals.push({ paper: c.paper_id, w: 2 * decay(c.created_at) });
  // Reading time: a glance counts little, five minutes or more counts most.
  for (const r of views.data ?? []) signals.push({ paper: r.paper_id, w: Math.min(5, r.seconds / 60) * decay(r.day) });

  const ids = [...new Set(signals.map((s) => s.paper))];
  const areaOf = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db.from("paper_scores").select("id, area").in("id", ids.slice(i, i + 200));
    for (const p of data ?? []) if (p.area) areaOf.set(p.id, p.area);
  }
  const area = new Map<string, number>();
  const group = new Map<string, number>();
  for (const s of signals) {
    const a = areaOf.get(s.paper);
    if (!a) continue;
    area.set(a, (area.get(a) ?? 0) + s.w);
    const g = AREAS[a]?.group;
    if (g) group.set(g, (group.get(g) ?? 0) + s.w);
  }
  const scale = (m: Map<string, number>) => {
    const top = Math.max(1e-9, ...[...m.values()].map(Math.abs));
    return new Map([...m].map(([k, v]) => [k, Math.max(-1, Math.min(1, v / top))]));
  };
  const papers = new Map<string, number>();
  for (const s of signals) papers.set(s.paper, (papers.get(s.paper) ?? 0) + s.w);
  return { area: scale(area), group: scale(group), papers };
}

// The areas a reader's activity points to most, for finding candidates.
export function topLearnedAreas(a: Affinity, n = 8): string[] {
  return [...a.area].filter(([, v]) => v > 0.2).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k]) => k);
}

// The ranked list, shared by the home shelf, the full For you page and agents (lib/agents.ts).
export type ForYou = {
  papers: Score[];
  hasTopics: boolean;
  topics: { picked: string[]; learned: string[] };
  reasons: Record<string, string>; // paper id -> why it's here, shown on the card
};

// Papers a reader engaged with most, for the embedding match (at most 50).
function seedPapers(learned: Affinity | null): { ids: string[]; weights: number[] } {
  const top = [...(learned?.papers ?? [])].filter(([, w]) => w > 0.05).sort((a, b) => b[1] - a[1]).slice(0, 50);
  return { ids: top.map(([id]) => id), weights: top.map(([, w]) => w) };
}

type Similar = { id: string; similarity: number; like_id: string; like_title: string };

export async function rankForYou(
  db: SupabaseClient,
  uid: string,
  limit: number,
  known: { prefs?: Prefs | null; voted?: Set<string> } = {},
): Promise<ForYou> {
  const [prefs, learned] = await Promise.all([
    known.prefs !== undefined ? known.prefs : loadPrefs(db, uid),
    learnedAffinity(db, uid).catch(() => null),
  ]);
  const picked = areaKeys(prefs?.areas ?? []);
  // Topics the reader picked come first; the ones their activity points to add a little.
  const fromActivity = (learned ? topLearnedAreas(learned) : []).filter((k) => !picked.includes(k));
  const keys = [...picked, ...fromActivity];
  const topics = { picked, learned: fromActivity };
  const seeds = seedPapers(learned);
  if (!keys.length && !seeds.ids.length) return { papers: [], hasTopics: false, topics, reasons: {} };
  const day = (n: number) => new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
  const since = day(DAYS);
  const venues = prefs?.venues ?? [];
  const [hot, mine, chosenTopics, conf, voted, near] = await Promise.all([
    // What's hot this month in any area: the timely part.
    db.from("paper_scores").select("*").not("score", "is", null).not("area", "is", null).gte("published_on", since)
      .order("hf_upvotes", { ascending: false, nullsFirst: false }).limit(Math.max(120, limit * 3)),
    // Recent papers in the reader's topics, even if nobody is upvoting them yet.
    db.from("paper_scores").select("*").in("area", keys).not("score", "is", null).gte("published_on", since)
      .order("score", { ascending: false }).limit(Math.max(60, limit * 2)),
    // The newest papers in the topics they picked, however far back that takes: a quiet
    // topic still fills the list, with its older papers below the fresh ones.
    picked.length
      ? db.from("paper_scores").select("*").in("area", picked).not("score", "is", null)
          .order("published_on", { ascending: false, nullsFirst: false }).limit(Math.max(60, limit * 2))
      : Promise.resolve({ data: [] }),
    // Conference papers have no publication date yet: the venues the reader follows.
    venues.length
      ? db.from("paper_scores").select("*").in("area", keys).not("score", "is", null)
          .or(venues.map((v) => `venue.ilike.${v}*`).join(",")).order("hf_upvotes", { ascending: false, nullsFirst: false }).limit(40)
      : Promise.resolve({ data: [] }),
    known.voted ?? votedOn(db, uid),
    // Papers closest in content to what they read, voted on and commented on (SPECTER2 vectors).
    seeds.ids.length
      ? db.rpc("similar_papers", { p_ids: seeds.ids, p_weights: seeds.weights, p_since: day(SIMILAR_DAYS), p_limit: Math.max(60, limit * 2) })
          .then((r) => (r.error ? [] : ((r.data ?? []) as Similar[])))
      : Promise.resolve([] as Similar[]),
  ]);
  // Their papers, as full rows.
  const nearIds = near.map((n) => n.id);
  const nearRows: Score[] = [];
  for (let i = 0; i < nearIds.length; i += 100) {
    const { data } = await db.from("paper_scores").select("*").in("id", nearIds.slice(i, i + 100)).not("score", "is", null);
    nearRows.push(...((data ?? []) as Score[]));
  }
  // Similarity relative to the best and worst match, 0..1.
  const sims = near.map((n) => n.similarity);
  const [lo, hi] = [Math.min(...sims), Math.max(...sims)];
  const closeness = new Map(near.map((n) => [n.id, hi > lo ? (n.similarity - lo) / (hi - lo) : 1]));
  const likeOf = new Map(near.map((n) => [n.id, n.like_title]));
  const all = new Map<string, Score>();
  for (const r of [hot, mine, chosenTopics, conf]) for (const s of (r.data ?? []) as Score[]) all.set(s.id, s);
  for (const s of nearRows) all.set(s.id, s);
  const fine = new Set(prefs?.areas ?? []);
  const maxHf = Math.max(1, ...[...all.values()].map((s) => s.hf_upvotes ?? 0));
  const now = Date.now();
  const rank = (s: Score) => {
    const age = s.published_on ? (now - Date.parse(s.published_on)) / 86400_000 : 10;
    const timely =
      0.6 * (Math.log1p(s.hf_upvotes ?? 0) / Math.log1p(maxHf)) + 0.25 * Math.max(0, 1 - age / DAYS) + 0.15 * Math.min(1, s.comments / 10);
    // Topics picked by hand rank highest (a single topic above a whole group). What the reader
    // votes on, comments on and reads adds less: papers close in content to those (up to 0.6)
    // or in the same topics (up to 0.5), and a topic they turn away from is pulled down.
    const chosen = s.area && fine.has(s.area) ? 1 : s.area && picked.includes(s.area) ? 0.85 : 0;
    const activity = s.area && learned
      ? 0.4 * (learned.area.get(s.area) ?? 0) + 0.15 * (learned.group.get(AREAS[s.area]?.group ?? "") ?? 0)
      : 0;
    const similar = 0.6 * (closeness.get(s.id) ?? 0);
    const interest = Math.max(-0.5, Math.min(1, Math.max(chosen, similar, Math.min(0.5, activity)) + Math.min(0, activity) * 0.5));
    const venue = venues.some((v) => s.venue?.startsWith(v)) ? 0.1 : 0;
    return 0.5 * interest + 0.3 * timely + 0.2 * (s.score ?? 0) + venue;
  };
  // Why each paper is here, strongest reason first.
  const reason = (s: Score): string => {
    const label = s.area ? AREAS[s.area]?.label : null;
    if (s.area && (fine.has(s.area) || picked.includes(s.area)) && label) return `In ${label}`;
    const like = likeOf.get(s.id);
    if (like && (closeness.get(s.id) ?? 0) > 0.25) return `Like “${like.length > 60 ? `${like.slice(0, 57)}…` : like}”`;
    if (s.area && label && (learned?.area.get(s.area) ?? 0) > 0.2) return `You read about ${label}`;
    return (s.hf_upvotes ?? 0) > 0 ? "Trending now" : "Highly rated";
  };
  // Variety: each paper from a topic already on the list counts a little less, except the
  // topics the reader picked, which stay on top.
  const mineTopic = (s: Score) => !!s.area && (fine.has(s.area) || picked.includes(s.area));
  const pool = [...all.values()].filter((s) => !voted.has(s.id)).map((s) => ({ s, r: rank(s) })).sort((a, b) => b.r - a.r);
  const papers: Score[] = [];
  const seen = new Map<string, number>();
  while (papers.length < limit && pool.length) {
    let best = 0;
    for (let i = 1; i < Math.min(pool.length, 40); i++) {
      const pen = (x: { s: Score; r: number }) => x.r - (mineTopic(x.s) ? 0 : 0.04 * (seen.get(x.s.area ?? "") ?? 0));
      if (pen(pool[i]) > pen(pool[best])) best = i;
    }
    const [{ s }] = pool.splice(best, 1);
    papers.push(s);
    seen.set(s.area ?? "", (seen.get(s.area ?? "") ?? 0) + 1);
  }
  return { papers, hasTopics: true, topics, reasons: Object.fromEntries(papers.map((s) => [s.id, reason(s)])) };
}

// The home page's "All papers" list, newest first, with papers in the reader's topics moved
// up as if they were newer: two weeks for topics picked by hand, three days for topics learned
// from activity. The browser keeps those topics in a cookie (TOPICS_COOKIE, "picked|learned",
// set by components/topicsCookie.ts) because sign-in lives in the browser, not on the server.
export const TOPICS_COOKIE = "gp_topics";
const HEAD_START_DAYS = { picked: 14, learned: 3 };

export type Topics = Map<string, number>; // area key -> head start in days

export function topicsFromCookie(value: string | undefined): Topics {
  const [picked = "", learned = ""] = (value ?? "").split("|");
  const keys = (list: string) => list.split(",").filter((k) => AREAS[k]).slice(0, 150);
  const out: Topics = new Map(keys(learned).map((k) => [k, HEAD_START_DAYS.learned]));
  for (const k of keys(picked)) out.set(k, HEAD_START_DAYS.picked);
  return out;
}

const effectiveTime = (s: Score, topics: Topics) =>
  (s.published_on ? Date.parse(s.published_on) : 0) + (s.area ? (topics.get(s.area) ?? 0) * 86400_000 : 0);

const activity = (s: Score) => {
  const t = (s as Score & { last_activity?: string | null }).last_activity;
  return t ? Date.parse(t) : 0;
};

// Topic keys by head start, one list query each (see mergeByTopics).
export function topicGroups(topics: Topics): string[][] {
  const by = new Map<number, string[]>();
  for (const [k, d] of topics) by.set(d, [...(by.get(d) ?? []), k]);
  return [...by.values()];
}

// Merges the newest papers overall with the newest in each group of the reader's topics.
// Exact for the first `n`, and stable as the list grows: within each list every paper gets
// the same head start, and ties break the way the database orders them (last activity, then
// id), so nothing outside the lists can rank higher.
export function mergeByTopics(lists: Score[][], topics: Topics, n: number): Score[] {
  const seen = new Map<string, Score>();
  for (const s of lists.flat()) seen.set(s.id, s);
  return [...seen.values()]
    .sort(
      (a, b) =>
        effectiveTime(b, topics) - effectiveTime(a, topics) ||
        activity(b) - activity(a) ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .slice(0, n);
}
