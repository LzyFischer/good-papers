// Home page shelves. Trending ranks recent activity on our site plus Hugging Face
// upvotes; quality (the score) is a separate shelf, so popularity never stands in
// for "worth reading".
import { serverClient } from "./supabase";
import type { Score } from "./types";

export const WINDOWS = { day: 1, week: 7, month: 30 } as const;
export type Window = keyof typeof WINDOWS;

const since = (days: number) => new Date(Date.now() - days * 86400_000).toISOString();

// trending = 3 x reader votes + 2 x reader comments + likes (all within the window)
//          + HF upvotes / 10 for papers published within the window
export async function trending(window: Window, n = 12): Promise<Score[]> {
  const db = serverClient();
  const from = since(WINDOWS[window]);
  const [votes, comments, likes, fresh] = await Promise.all([
    db.from("ratings").select("paper_id").gte("updated_at", from).not("worth_reading", "is", null).limit(5000),
    db.from("comments").select("paper_id").eq("author_kind", "user").gte("created_at", from).limit(5000),
    db.from("comment_likes").select("comments(paper_id)").gte("created_at", from).limit(5000),
    db.from("paper_scores").select("id, hf_upvotes").gte("published_on", from.slice(0, 10)).gt("hf_upvotes", 0).limit(500),
  ]);
  const heat = new Map<string, number>();
  const add = (id: string | undefined, x: number) => id && heat.set(id, (heat.get(id) ?? 0) + x);
  for (const r of votes.data ?? []) add(r.paper_id, 3);
  for (const r of comments.data ?? []) add(r.paper_id, 2);
  for (const r of (likes.data ?? []) as unknown as { comments: { paper_id: string } | null }[]) add(r.comments?.paper_id, 1);
  for (const r of fresh.data ?? []) add(r.id, (r.hf_upvotes ?? 0) / 10);
  const ids = [...heat.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([id]) => id);
  if (ids.length === 0) return [];
  const { data } = await db.from("paper_scores").select("*").in("id", ids).not("score", "is", null);
  const byId = new Map(((data ?? []) as Score[]).map((s) => [s.id, s]));
  return ids.map((id) => byId.get(id)).filter((s): s is Score => Boolean(s));
}

export async function shelf(kind: "must" | "debated" | "new", n = 12): Promise<Score[]> {
  let q = serverClient().from("paper_scores").select("*").not("score", "is", null);
  if (kind === "must") q = q.gte("score", 0.8).order("score", { ascending: false });
  if (kind === "debated") q = q.gt("comments", 0).order("comments", { ascending: false });
  if (kind === "new") q = q.order("published_on", { ascending: false, nullsFirst: false });
  const { data } = await q.limit(n);
  return (data ?? []) as Score[];
}
