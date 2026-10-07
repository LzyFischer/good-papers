// NeurIPS 2026 (scripts/import-neurips.ts): tracks, poster sessions and a trending shelf.
import { serverClient } from "./supabase";
export { sessionWhen } from "./sessions";
import type { Score } from "./types";

export const NEURIPS = "NeurIPS 2026";

export const TRACKS = {
  oral: { label: "Orals", one: "Oral" },
  spotlight: { label: "Spotlights", one: "Spotlight" },
  poster: { label: "Posters", one: "Poster" },
} as const;
export type Track = keyof typeof TRACKS;

export type SessionRow = { id: string; session: string; starts_at: string | null; ends_at: string | null; room: string | null; rank: number };

// The best `perSession` papers of every session, sessions in time order.
export async function bestBySession(perSession = 6) {
  const db = serverClient();
  const rows: SessionRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await db
      .from("conf_session_papers")
      .select("id, session, starts_at, ends_at, room, rank")
      .eq("venue", NEURIPS)
      .lte("rank", perSession)
      .order("starts_at")
      .order("session")
      .order("rank")
      .range(from, from + 999);
    rows.push(...((data ?? []) as SessionRow[]));
    if (!data || data.length < 1000) break;
  }
  const { count } = await db.from("conf_session_papers").select("id", { count: "exact", head: true }).eq("venue", NEURIPS);
  const scores = await scoresFor([...new Set(rows.map((r) => r.id))]);
  const sessions = new Map<string, { name: string; start: string | null; end: string | null; room: string | null; papers: Score[] }>();
  for (const r of rows) {
    const s = sessions.get(r.session) ?? { name: r.session, start: r.starts_at, end: r.ends_at, room: r.room, papers: [] };
    const p = scores.get(r.id);
    if (p) s.papers.push(p);
    sessions.set(r.session, s);
  }
  return { sessions: [...sessions.values()], total: count ?? 0 };
}

export async function sessionPapers(session: string): Promise<{ papers: Score[]; room: string | null; start: string | null; end: string | null }> {
  const { data } = await serverClient()
    .from("conf_session_papers")
    .select("id, starts_at, ends_at, room")
    .eq("venue", NEURIPS)
    .eq("session", session)
    .order("rank")
    .limit(1000);
  const rows = (data ?? []) as { id: string; starts_at: string | null; ends_at: string | null; room: string | null }[];
  const scores = await scoresFor(rows.map((r) => r.id));
  return {
    papers: rows.map((r) => scores.get(r.id)).filter((s): s is Score => Boolean(s)),
    room: rows[0]?.room ?? null,
    start: rows[0]?.starts_at ?? null,
    end: rows[0]?.ends_at ?? null,
  };
}

// A track's papers, best first (rated ones before unrated).
export async function trackPapers(track: Track | null, limit: number): Promise<Score[]> {
  let q = serverClient().from("paper_scores").select("*").eq("venue", NEURIPS);
  if (track) q = q.eq("conf_track", track);
  const { data } = await q.order("score", { ascending: false, nullsFirst: false }).order("id").limit(limit);
  return (data ?? []) as Score[];
}

// Trending at NeurIPS: Hugging Face upvotes and activity here, then the best-rated orals.
export async function neuripsTrending(n = 24): Promise<Score[]> {
  const db = serverClient();
  const [hot, best] = await Promise.all([
    db.from("paper_scores").select("*").eq("venue", NEURIPS).gt("hf_upvotes", 0).order("hf_upvotes", { ascending: false }).limit(n),
    db.from("paper_scores").select("*").eq("venue", NEURIPS).not("score", "is", null)
      .order("comments", { ascending: false }).order("score", { ascending: false }).limit(n * 2),
  ]);
  const heat = (s: Score) => (s.hf_upvotes ?? 0) / 10 + s.comments * 2 + s.reader_total * 3 + (s.score ?? 0) * 5;
  const all = new Map<string, Score>();
  for (const s of [...((hot.data ?? []) as Score[]), ...((best.data ?? []) as Score[])]) all.set(s.id, s);
  return [...all.values()].sort((a, b) => heat(b) - heat(a)).slice(0, n);
}

async function scoresFor(ids: string[]): Promise<Map<string, Score>> {
  const out = new Map<string, Score>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await serverClient().from("paper_scores").select("*").in("id", ids.slice(i, i + 200));
    for (const s of (data ?? []) as Score[]) out.set(s.id, s);
  }
  return out;
}
