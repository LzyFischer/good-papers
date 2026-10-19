// Matches between authors (server only, service role). Two readers match when both opted in
// (match_optin), both claimed papers through ORCID (paper_claims), and each read at least one
// of the other's papers. "Read" is any of: a vote either way (or "read it"), a ♥ in the home
// deck (paper_interest), or a minute on the paper page (reader_views). The more of each
// other's papers they read, the stronger the match. Which way anyone voted is never shown.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Match = {
  userId: string;
  name: string | null;
  orcid: string | null;
  theyRead: number; // of your papers
  youRead: number; // of theirs
  papers: { id: string; title: string }[]; // a few of theirs
};

export type MatchesResult =
  | { status: "off" } // not opted in
  | { status: "no-claims" } // nothing claimed yet
  | { status: "ok"; matches: Match[] };

const READ_SECONDS = 60;

async function chunked<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...((await run(ids.slice(i, i + 100))).data ?? []));
  return out;
}

// Who read which of `papers`, restricted to `readers` when given: user id -> paper ids.
async function readersOf(db: SupabaseClient, papers: string[], readers?: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const add = (u: string, p: string) => out.set(u, (out.get(u) ?? new Set()).add(p));
  type Row = { user_id: string; paper_id: string; seconds?: number };
  const rows = (table: string, cols: string) =>
    chunked<Row>(papers, (c) => {
      const q = db.from(table).select(cols).in("paper_id", c);
      return (readers ? q.in("user_id", readers) : q) as unknown as PromiseLike<{ data: Row[] | null }>;
    });
  const [votes, hearts, views] = await Promise.all([
    rows("ratings", "user_id, paper_id"),
    rows("paper_interest", "user_id, paper_id"),
    rows("reader_views", "user_id, paper_id, seconds"),
  ]);
  for (const r of votes) add(r.user_id, r.paper_id);
  for (const r of hearts) add(r.user_id, r.paper_id);
  const seconds = new Map<string, number>();
  for (const r of views) seconds.set(`${r.user_id}|${r.paper_id}`, (seconds.get(`${r.user_id}|${r.paper_id}`) ?? 0) + (r.seconds ?? 0));
  for (const [k, s] of seconds) if (s >= READ_SECONDS) add(k.split("|")[0], k.split("|")[1]);
  return out;
}

export async function matchesFor(db: SupabaseClient, me: string): Promise<MatchesResult> {
  const { data: optin } = await db.from("match_optin").select("user_id");
  const opted = new Set((optin ?? []).map((r) => r.user_id as string));
  if (!opted.has(me)) return { status: "off" };

  const { data: mine } = await db.from("paper_claims").select("paper_id").eq("user_id", me);
  const myPapers = (mine ?? []).map((r) => r.paper_id as string);
  if (!myPapers.length) return { status: "no-claims" };

  // Opted-in readers who read my papers.
  const others = [...opted].filter((u) => u !== me);
  if (!others.length) return { status: "ok", matches: [] };
  const readMine = await readersOf(db, myPapers, others);
  const candidates = [...readMine.keys()].filter((u) => u !== me);
  if (!candidates.length) return { status: "ok", matches: [] };

  // Their claimed papers, and which of those I read.
  const theirClaims = await chunked<{ user_id: string; paper_id: string }>(candidates, (c) =>
    db.from("paper_claims").select("user_id, paper_id").in("user_id", c),
  );
  const theirs = new Map<string, string[]>();
  for (const r of theirClaims) theirs.set(r.user_id, [...(theirs.get(r.user_id) ?? []), r.paper_id]);
  const allTheirs = [...new Set(theirClaims.map((r) => r.paper_id))];
  const iRead = (await readersOf(db, allTheirs, [me])).get(me) ?? new Set<string>();

  const pairs = candidates
    .map((u) => ({ u, theyRead: readMine.get(u)?.size ?? 0, youRead: (theirs.get(u) ?? []).filter((p) => iRead.has(p)).length }))
    .filter((m) => m.theyRead > 0 && m.youRead > 0)
    .sort((a, b) => b.theyRead + b.youRead - (a.theyRead + a.youRead));
  if (!pairs.length) return { status: "ok", matches: [] };

  const ids = pairs.map((p) => p.u);
  const [{ data: accounts }, titles] = await Promise.all([
    db.from("orcid_accounts").select("user_id, name, orcid").in("user_id", ids),
    chunked<{ id: string; title: string }>(
      [...new Set(pairs.flatMap((p) => (theirs.get(p.u) ?? []).slice(0, 3)))],
      (c) => db.from("papers").select("id, title").in("id", c),
    ),
  ]);
  const acct = new Map((accounts ?? []).map((a) => [a.user_id as string, a as { name: string | null; orcid: string }]));
  const title = new Map(titles.map((t) => [t.id, t.title]));
  return {
    status: "ok",
    matches: pairs.map((p) => ({
      userId: p.u,
      name: acct.get(p.u)?.name ?? null,
      orcid: acct.get(p.u)?.orcid ?? null,
      theyRead: p.theyRead,
      youRead: p.youRead,
      papers: (theirs.get(p.u) ?? []).slice(0, 3).flatMap((id) => (title.has(id) ? [{ id, title: title.get(id)! }] : [])),
    })),
  };
}
