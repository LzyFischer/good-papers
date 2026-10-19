// Matches between authors (server only, service role). Two readers match when both opted in
// (match_optin), both claimed papers through ORCID (paper_claims), and each voted on at least
// one of the other's papers, either way (the home deck's ♥ and ✕ are votes too). The more of
// each other's papers they voted on, the stronger the match. Which way is never shown.
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

async function chunked<T>(ids: string[], run: (chunk: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 100) out.push(...((await run(ids.slice(i, i + 100))).data ?? []));
  return out;
}

// Who voted on which of `papers` (either way, or "read it"), restricted to `readers` when
// given: user id -> paper ids.
async function readersOf(db: SupabaseClient, papers: string[], readers?: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  const votes = await chunked<{ user_id: string; paper_id: string }>(papers, (c) => {
    const q = db.from("ratings").select("user_id, paper_id").in("paper_id", c);
    return readers ? q.in("user_id", readers) : q;
  });
  for (const r of votes) out.set(r.user_id, (out.get(r.user_id) ?? new Set()).add(r.paper_id));
  return out;
}

export async function matchesFor(db: SupabaseClient, me: string): Promise<MatchesResult> {
  const { data: optin } = await db.from("match_optin").select("user_id");
  const opted = new Set((optin ?? []).map((r) => r.user_id as string));
  if (!opted.has(me)) return { status: "off" };

  const { data: mine } = await db.from("paper_claims").select("paper_id").eq("user_id", me);
  const myPapers = (mine ?? []).map((r) => r.paper_id as string);
  if (!myPapers.length) return { status: "no-claims" };

  // Opted-in readers who read my papers, leaving out anyone either of us blocked.
  const { data: blocks } = await db.from("match_blocks").select("blocker, blocked").or(`blocker.eq.${me},blocked.eq.${me}`);
  const blocked = new Set((blocks ?? []).map((b) => (b.blocker === me ? b.blocked : b.blocker) as string));
  const others = [...opted].filter((u) => u !== me && !blocked.has(u));
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

// Are these two a match right now (both opted in, each voted on one of the other's claimed
// papers, no block either way)? The check before every message.
export async function isMatch(db: SupabaseClient, a: string, b: string): Promise<boolean> {
  if (a === b) return false;
  const [{ data: optin }, { data: blocks }, { data: claims }] = await Promise.all([
    db.from("match_optin").select("user_id").in("user_id", [a, b]),
    db.from("match_blocks").select("blocker").or(`and(blocker.eq.${a},blocked.eq.${b}),and(blocker.eq.${b},blocked.eq.${a})`),
    db.from("paper_claims").select("user_id, paper_id").in("user_id", [a, b]),
  ]);
  if ((optin ?? []).length < 2 || (blocks ?? []).length) return false;
  const papersOf = (u: string) => (claims ?? []).filter((c) => c.user_id === u).map((c) => c.paper_id as string);
  const voted = async (voter: string, papers: string[]) => {
    if (!papers.length) return false;
    const { count } = await db.from("ratings").select("paper_id", { count: "exact", head: true }).eq("user_id", voter).in("paper_id", papers.slice(0, 500));
    return (count ?? 0) > 0;
  };
  const [ab, ba] = await Promise.all([voted(a, papersOf(b)), voted(b, papersOf(a))]);
  return ab && ba;
}
