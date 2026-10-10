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

export type Affinity = { area: Map<string, number>; group: Map<string, number> }; // -1..1

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
  return { area: scale(area), group: scale(group) };
}

// The areas a reader's activity points to most, for finding candidates.
export function topLearnedAreas(a: Affinity, n = 8): string[] {
  return [...a.area].filter(([, v]) => v > 0.2).sort((x, y) => y[1] - x[1]).slice(0, n).map(([k]) => k);
}

// The ranked list, shared by the home shelf, the full For you page and agents (lib/agents.ts).
export async function rankForYou(
  db: SupabaseClient,
  uid: string,
  limit: number,
  known: { prefs?: Prefs | null; voted?: Set<string> } = {},
): Promise<{ papers: Score[]; hasTopics: boolean }> {
  const [prefs, learned] = await Promise.all([
    known.prefs !== undefined ? known.prefs : loadPrefs(db, uid),
    learnedAffinity(db, uid).catch(() => null),
  ]);
  const picked = areaKeys(prefs?.areas ?? []);
  // Topics the reader picked, plus the ones their activity points to.
  const keys = [...new Set([...picked, ...(learned ? topLearnedAreas(learned) : [])])];
  if (!keys.length) return { papers: [], hasTopics: false };
  const since = new Date(Date.now() - DAYS * 86400_000).toISOString().slice(0, 10);
  const venues = prefs?.venues ?? [];
  const [hot, mine, conf, voted] = await Promise.all([
    // What's hot this month in any area: the timely part.
    db.from("paper_scores").select("*").not("score", "is", null).not("area", "is", null).gte("published_on", since)
      .order("hf_upvotes", { ascending: false, nullsFirst: false }).limit(Math.max(120, limit * 3)),
    // Recent papers in the reader's topics, even if nobody is upvoting them yet.
    db.from("paper_scores").select("*").in("area", keys).not("score", "is", null).gte("published_on", since)
      .order("score", { ascending: false }).limit(Math.max(60, limit * 2)),
    // Conference papers have no publication date yet: the venues the reader follows.
    venues.length
      ? db.from("paper_scores").select("*").in("area", keys).not("score", "is", null)
          .or(venues.map((v) => `venue.ilike.${v}*`).join(",")).order("hf_upvotes", { ascending: false, nullsFirst: false }).limit(40)
      : Promise.resolve({ data: [] }),
    known.voted ?? votedOn(db, uid),
  ]);
  const all = new Map<string, Score>();
  for (const s of [...((hot.data ?? []) as Score[]), ...((mine.data ?? []) as Score[]), ...((conf.data ?? []) as Score[])]) all.set(s.id, s);
  const fine = new Set(prefs?.areas ?? []);
  const maxHf = Math.max(1, ...[...all.values()].map((s) => s.hf_upvotes ?? 0));
  const now = Date.now();
  const rank = (s: Score) => {
    const age = s.published_on ? (now - Date.parse(s.published_on)) / 86400_000 : 10;
    const timely =
      0.6 * (Math.log1p(s.hf_upvotes ?? 0) / Math.log1p(maxHf)) + 0.25 * Math.max(0, 1 - age / DAYS) + 0.15 * Math.min(1, s.comments / 10);
    // A topic picked by name beats a whole followed group; outside the reader's topics counts little.
    const chosen = s.area && fine.has(s.area) ? 1 : s.area && picked.includes(s.area) ? 0.75 : 0;
    const fromActivity = s.area && learned
      ? 0.8 * (learned.area.get(s.area) ?? 0) + 0.4 * (learned.group.get(AREAS[s.area]?.group ?? "") ?? 0)
      : 0;
    // What they picked sets the floor; what they read and vote on can lift it, or pull it down.
    const interest = Math.max(-0.5, Math.min(1, Math.max(chosen, fromActivity) + Math.min(0, fromActivity) * 0.5));
    const venue = venues.some((v) => s.venue?.startsWith(v)) ? 0.15 : 0;
    return 0.45 * timely + 0.35 * interest + 0.2 * (s.score ?? 0) + venue;
  };
  return { papers: [...all.values()].filter((s) => !voted.has(s.id)).sort((a, b) => rank(b) - rank(a)).slice(0, limit), hasTopics: true };
}
