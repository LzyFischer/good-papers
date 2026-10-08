// "Ask" box: Jev reads a question into intent + time window + area, and the
// answer is built from our own data (scores, comments, trending), so every
// paper it names is real. Jev can't write text and doesn't need to here.
import { AREA_GROUPS, AREAS } from "./areas";
import { systemOne } from "./jev";
import { serverClient } from "./supabase";
import { NEURIPS, neuripsTrending } from "./neurips";
import { trending } from "./trending";
import type { Score } from "./types";

export const INTENTS = {
  worth: { label: "Worth reading", criteria: "Wants recommendations: the best or most worthwhile papers to read" },
  trending: { label: "Trending", criteria: "Wants what is popular or getting attention right now" },
  debated: { label: "Most debated", criteria: "Wants controversial papers or the most discussed ones" },
  who: { label: "Who's working on it", criteria: "Wants to know which researchers, labs or institutions work on a topic" },
  newest: { label: "Newest", criteria: "Wants the latest or newest papers" },
} as const;
export type Intent = keyof typeof INTENTS;

const WINDOWS = {
  day: { label: "today", days: 1, criteria: "Today or the last day" },
  week: { label: "this week", days: 7, criteria: "This week or the last few days" },
  month: { label: "this month", days: 30, criteria: "This month or the last few weeks" },
  year: { label: "this year", days: 365, criteria: "This year or the last few months" },
  any: { label: "any time", days: 0, criteria: "No time frame mentioned" },
} as const;

export type Answer = {
  intent: Intent;
  window: keyof typeof WINDOWS;
  windowLabel: string;
  area: { key: string; label: string; group: boolean } | null;
  papers: Score[];
  people: { name: string; papers: number }[];
  orgs: { name: string; papers: number }[];
  venue: string | null; // "NeurIPS 2026" when the question names it
  track: "oral" | "spotlight" | "poster" | null;
  more: boolean; // more papers than shown
};

export async function ask(question: string, limit = 40): Promise<Answer> {
  const groups = Object.fromEntries(
    Object.entries(AREA_GROUPS).filter(([k]) => k !== "other").map(([k, g]) => [k, g.criteria]),
  );
  const first = await systemOne(
    { question },
    {
      intent: { type: "choice", instructions: "What does `question` ask for?", criteria: Object.fromEntries(Object.entries(INTENTS).map(([k, v]) => [k, v.criteria])) },
      window: { type: "choice", instructions: "What time frame does `question` ask about?", criteria: Object.fromEntries(Object.entries(WINDOWS).map(([k, v]) => [k, v.criteria])) },
      group: { type: "choice", instructions: "Which research area is `question` about?", criteria: { ...groups, any: "No specific research area, or all of AI" } },
    },
  );
  const pick = <T extends string>(k: string, fallback: T) => {
    const a = first.answers[k];
    return (a?.type === "choice" ? a.choice : fallback) as T;
  };
  const intent = pick<Intent>("intent", "worth");
  const window = pick<keyof typeof WINDOWS>("window", "any");
  const group = pick<string>("group", "any");

  let area: Answer["area"] = null;
  let areaKeys: string[] | null = null;
  if (AREA_GROUPS[group] && Object.keys(AREA_GROUPS[group].areas).length) {
    const fine = AREA_GROUPS[group].areas;
    const second = await systemOne(
      { question },
      { area: { type: "choice", instructions: "Which topic is `question` about?", criteria: { ...fine, broad: `The whole area of ${AREA_GROUPS[group].label}, no narrower topic` } } },
    ).catch(() => null);
    const choice = second?.answers.area?.type === "choice" ? second.answers.area.choice : "broad";
    if (choice !== "broad" && AREAS[choice]) {
      area = { key: choice, label: AREAS[choice].label, group: false };
      areaKeys = [choice];
    } else {
      area = { key: group, label: AREA_GROUPS[group].label, group: true };
      areaKeys = Object.keys(fine);
    }
  }

  // "at NeurIPS", "NeurIPS orals": that conference's papers only, whatever the time frame.
  const neurips = /neurips|nips\b/i.test(question);
  const confTrack = neurips ? (/\boral/i.test(question) ? "oral" : /spotlight/i.test(question) ? "spotlight" : /poster/i.test(question) ? "poster" : null) : null;
  const days = neurips ? 0 : WINDOWS[window].days;
  let papers: Score[];
  if (neurips && intent === "trending") {
    papers = (await neuripsTrending(limit + 60)).filter((s) => (!areaKeys || (s.area && areaKeys.includes(s.area))) && (!confTrack || s.conf_track === confTrack));
  } else if (intent === "trending") {
    const w = days && days <= 1 ? "day" : days && days <= 7 ? "week" : days && days <= 30 ? "month" : "year";
    papers = (await trending(w, limit + 60)).filter((s) => !areaKeys || (s.area && areaKeys.includes(s.area)));
  } else {
    let q = serverClient().from("paper_scores").select("*").not("score", "is", null).not("area", "is", null);
    if (neurips) q = q.eq("venue", NEURIPS);
    if (confTrack) q = q.eq("conf_track", confTrack);
    if (areaKeys) q = q.in("area", areaKeys);
    if (days) q = q.gte("published_on", new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10));
    if (intent === "debated") q = q.order("comments", { ascending: false });
    else if (intent === "newest") q = q.order("published_on", { ascending: false, nullsFirst: false });
    else q = q.order("score", { ascending: false });
    papers = ((await q.limit(limit + 1)).data ?? []) as Score[];
  }

  // "Who's working on it": count authors and institutions over every matching paper,
  // not just the ones on screen (page through authors and orgs only, up to 20,000 papers).
  let pool: { authors: string[] | null; orgs: string[] | null }[] = [];
  if (intent === "who") {
    for (let from = 0; from < 20000; from += 1000) {
      let q = serverClient().from("paper_scores").select("authors, orgs").not("score", "is", null).not("area", "is", null);
      if (neurips) q = q.eq("venue", NEURIPS);
      if (confTrack) q = q.eq("conf_track", confTrack);
      if (areaKeys) q = q.in("area", areaKeys);
      if (days) q = q.gte("published_on", new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10));
      const { data } = await q.order("id").range(from, from + 999);
      pool.push(...((data ?? []) as typeof pool));
      if (!data || data.length < 1000) break;
    }
  }
  const count = (names: string[][]) => {
    const m = new Map<string, number>();
    for (const list of names) for (const n of new Set(list)) m.set(n, (m.get(n) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, papers]) => ({ name, papers }));
  };
  const people = intent === "who" ? count(pool.map((p) => p.authors ?? [])) : [];
  // NeurIPS lists some affiliations twice ("Tsinghua University, Tsinghua University").
  const tidy = (o: string) => [...new Set(o.split(/\s*,\s*/))].join(", ");
  const orgs = intent === "who" ? count(pool.map((p) => (p.orgs ?? []).map(tidy))) : [];
  pool = [];
  return {
    intent,
    window,
    windowLabel: WINDOWS[window].label,
    area,
    papers: papers.slice(0, limit),
    people,
    orgs,
    venue: neurips ? NEURIPS : null,
    track: confTrack,
    more: papers.length > limit,
  };
}
