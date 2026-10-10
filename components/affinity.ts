"use client";
// What a reader's own activity says about their interests, area by area: votes, comments
// and reading time on paper pages (reader_views), newer activity counting more.
import { AREAS } from "@/lib/areas";
import { browserClient } from "@/lib/supabase";

const HALF_LIFE_DAYS = 30;
const WINDOW_DAYS = 120;

export type Affinity = { area: Map<string, number>; group: Map<string, number> }; // -1..1

export async function learnedAffinity(uid: string): Promise<Affinity> {
  const db = browserClient();
  const since = new Date(Date.now() - WINDOW_DAYS * 86400_000).toISOString();
  const [votes, comments, views] = await Promise.all([
    db.from("ratings").select("paper_id, worth_reading, updated_at").eq("user_id", uid).gte("updated_at", since).limit(1000),
    db.from("comments").select("paper_id, created_at").eq("user_id", uid).gte("created_at", since).limit(1000),
    db.from("reader_views").select("paper_id, seconds, day").gte("day", since.slice(0, 10)).limit(2000),
  ]);
  const decay = (iso: string) => Math.pow(0.5, (Date.now() - Date.parse(iso)) / 86400_000 / HALF_LIFE_DAYS);
  const signals: { paper: string; w: number }[] = [];
  for (const v of votes.data ?? []) signals.push({ paper: v.paper_id, w: (v.worth_reading === true ? 3 : v.worth_reading === false ? -2 : 1) * decay(v.updated_at) });
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
