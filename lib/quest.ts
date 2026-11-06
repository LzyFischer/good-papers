// NeurIPS Quest (app/neurips/quest): every poster session as a pixel-art hall to walk.
// Cached for an hour: the halls only change when the papers are re-imported or re-rated.
import { unstable_cache } from "next/cache";
import { tierOf } from "@/components/Score";
import { NEURIPS } from "./neurips";
import { serverClient } from "./supabase";
import type { Score } from "./types";

export const CITIES = ["Sydney", "Atlanta", "Paris"] as const;
export type City = (typeof CITIES)[number];

export type QuestSession = { name: string; city: City; n: number; start: string | null; end: string | null; room: string | null };
// One poster, trimmed for the client: a session holds up to ~1,050 of them.
export type QuestPaper = { id: string; t: string; au: string[]; a: string | null; tone: number; tier: string; pct: number; b: number };

type Row = { id: string; session: string; starts_at: string | null; ends_at: string | null; room: string | null };

async function allRows(session?: string): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += 1000) {
    let q = serverClient().from("conf_session_papers").select("id, session, starts_at, ends_at, room").eq("venue", NEURIPS);
    if (session) q = q.eq("session", session);
    const { data } = await q.order("session").order("id").range(from, from + 999);
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

export const questSessions = unstable_cache(
  async (): Promise<QuestSession[]> => {
    const by = new Map<string, QuestSession>();
    for (const r of await allRows()) {
      const city = r.session.split(" ")[0] as City;
      if (!CITIES.includes(city) || !/Poster Session \d/.test(r.session)) continue;
      const s = by.get(r.session) ?? { name: r.session, city, n: 0, start: r.starts_at, end: r.ends_at, room: r.room };
      s.n++;
      by.set(r.session, s);
    }
    return [...by.values()].sort((a, b) => (a.start ?? "").localeCompare(b.start ?? "") || a.name.localeCompare(b.name));
  },
  ["quest-sessions"],
  { revalidate: 3600, tags: ["neurips-quest"] },
);

// Placeholder board numbers, stable per paper, until NeurIPS publishes the real ones.
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;

export const questPapers = unstable_cache(
  async (session: string): Promise<QuestPaper[]> => {
    const ids = (await allRows(session)).map((r) => r.id);
    const scores: Score[] = [];
    for (let i = 0; i < ids.length; i += 200) {
      const { data } = await serverClient().from("paper_scores").select("id, title, authors, area, score, reader_total, ai_total").in("id", ids.slice(i, i + 200));
      scores.push(...((data ?? []) as Score[]));
    }
    return scores
      .sort((a, b) => hash(a.id) - hash(b.id))
      .map((s, i) => {
        const t = tierOf(s);
        return { id: s.id, t: s.title, au: (s.authors ?? []).slice(0, 3), a: s.area, tone: t?.tone ?? 0, tier: t?.label ?? "Not rated yet", pct: t?.pct ?? 0, b: i + 1 };
      });
  },
  ["quest-papers"],
  { revalidate: 3600, tags: ["neurips-quest"] },
);
