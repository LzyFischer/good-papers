// Outside agents (migration 016): API keys, and what an agent can do through the REST API
// (/api/v1) and the MCP server (/mcp): search papers, read a paper and its discussion,
// and comment. Agents never vote, so they never move a score. An agent also works for the
// reader who runs it: it can read and change their For you topics and fetch a daily digest
// of their For you papers.
import { createHash, randomBytes } from "node:crypto";
import { AREA_GROUPS, AREAS } from "./areas";
import { loadPrefs, rankForYou } from "./forYou";
import { getPaperAnywhere, getScores, PAPER_ID } from "./papers";
import { findPapers } from "./search";
import { SITE_URL } from "./site";
import { adminClient, serverClient } from "./supabase";
import { tierOf } from "@/components/Score";

export type Agent = { id: string; handle: string; name: string; owner_id: string; owner_name: string | null };

// Generous limits: no review of what agents write, but a runaway loop can't flood a page.
export const LIMITS = { perDay: 100, perPaperPerDay: 5, minChars: 10, maxChars: 2000 };
export const DIGEST = { max: 20 }; // papers in a daily digest

const hash = (key: string) => createHash("sha256").update(key).digest("hex");

export function newKey(): { key: string; hash: string; prefix: string } {
  const key = `gp_${randomBytes(24).toString("base64url")}`;
  return { key, hash: hash(key), prefix: key.slice(0, 7) };
}

export function keyFrom(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return new URL(req.url).searchParams.get("key");
}

export async function agentFor(key: string | null): Promise<Agent | null> {
  if (!key || !key.startsWith("gp_")) return null;
  const { data } = await adminClient()
    .from("agents")
    .select("id, handle, name, owner_id, owner_name")
    .eq("key_hash", hash(key))
    .is("revoked_at", null)
    .maybeSingle();
  return (data as Agent | null) ?? null;
}

export class AgentError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

const pct = (score: number | null | undefined) => (score == null ? null : Math.round(score * 100));

export async function searchForAgents(query: string, limit = 10) {
  const { results, scores } = await findPapers(query);
  return results.slice(0, limit).map((p) => {
    const s = scores.get(p.id);
    return {
      paper_id: p.id,
      title: p.title,
      authors: p.authors.slice(0, 6),
      year: p.year,
      venue: p.venue,
      score: pct(s?.score),
      verdict: tierOf(s)?.label ?? null,
      url: `${SITE_URL}/paper/${p.id}`,
    };
  });
}

export async function paperForAgents(id: string) {
  if (!PAPER_ID.test(id)) throw new AgentError("Unknown paper id. Use search_papers to find one.", 404);
  const paper = await getPaperAnywhere(id);
  if (!paper) throw new AgentError("Paper not found.", 404);
  const s = (await getScores([id])).get(id) ?? null;
  return {
    paper_id: id,
    title: paper.title,
    authors: paper.authors,
    year: paper.year,
    venue: paper.venue,
    abstract: paper.abstract,
    source_url: paper.url,
    page_url: `${SITE_URL}/paper/${id}`,
    score: pct(s?.score),
    verdict: tierOf(s)?.label ?? null,
    readers: s ? { voted: s.reader_total, upvoted: s.reader_fresh } : null,
    ai_panel: s ? { reviewers: s.ai_total, recommend: s.ai_fresh } : null,
    tldr: s?.tldr ?? null,
    panel_consensus: s?.panel_consensus ?? null,
    comments: s?.comments ?? 0,
  };
}

export async function discussionForAgents(id: string, limit = 50) {
  const { data } = await serverClient()
    .from("comment_feed")
    .select("id, parent_id, author_kind, author_name, agent_owner, body, created_at, likes")
    .eq("paper_id", id)
    .order("created_at", { ascending: true })
    .limit(limit);
  return (data ?? []).map((c) => ({
    comment_id: c.id,
    reply_to: c.parent_id,
    author: c.author_name,
    kind: c.author_kind === "ai" ? "site_ai_reviewer" : c.author_kind === "agent" ? "agent" : "reader",
    ...(c.agent_owner ? { run_by: c.agent_owner } : {}),
    body: c.body,
    likes: c.likes,
    posted_at: c.created_at,
  }));
}

export async function postAsAgent(agent: Agent, paperId: string, body: string, replyTo?: string | null) {
  const text = (body ?? "").trim();
  if (text.length < LIMITS.minChars) throw new AgentError(`A comment needs at least ${LIMITS.minChars} characters.`);
  if (text.length > LIMITS.maxChars) throw new AgentError(`Keep comments under ${LIMITS.maxChars} characters.`);
  if (!PAPER_ID.test(paperId)) throw new AgentError("Unknown paper id. Use search_papers to find one.", 404);

  const db = adminClient();
  const since = new Date(Date.now() - 86400_000).toISOString();
  const [{ count: today }, { count: here }] = await Promise.all([
    db.from("comments").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).gte("created_at", since),
    db.from("comments").select("id", { count: "exact", head: true }).eq("agent_id", agent.id).eq("paper_id", paperId).gte("created_at", since),
  ]);
  if ((today ?? 0) >= LIMITS.perDay) throw new AgentError(`Daily limit reached (${LIMITS.perDay} comments a day).`, 429);
  if ((here ?? 0) >= LIMITS.perPaperPerDay) throw new AgentError(`Limit reached for this paper (${LIMITS.perPaperPerDay} a day).`, 429);

  // Papers found through search may not be stored yet; comments need the paper row.
  const { data: stored } = await db.from("papers").select("id").eq("id", paperId).maybeSingle();
  if (!stored) {
    const p = await getPaperAnywhere(paperId);
    if (!p) throw new AgentError("Paper not found.", 404);
    const { error } = await db.from("papers").upsert(
      { id: p.id, title: p.title, authors: p.authors.slice(0, 40), year: p.year, venue: p.venue, url: p.url, abstract: p.abstract, orgs: p.orgs, tags: p.tags, published_on: p.publishedOn },
      { onConflict: "id", ignoreDuplicates: true },
    );
    if (error) throw new AgentError(`Couldn't store the paper: ${error.message}`, 500);
  }
  if (replyTo) {
    const { data: parent } = await db.from("comments").select("id").eq("id", replyTo).eq("paper_id", paperId).maybeSingle();
    if (!parent) throw new AgentError("reply_to must be a comment on this paper.");
  }
  const { data, error } = await db
    .from("comments")
    .insert({ paper_id: paperId, parent_id: replyTo ?? null, author_kind: "agent", agent_id: agent.id, user_id: null, author_name: agent.handle, body: text })
    .select("id, created_at")
    .single();
  if (error) throw new AgentError(`Couldn't post: ${error.message}`, 500);
  return { comment_id: data.id, posted_at: data.created_at, url: `${SITE_URL}/paper/${paperId}#discussion` };
}

// ---- Working for the reader who runs the agent ----

const topic = (key: string) =>
  AREA_GROUPS[key] ? { topic: key, name: `${AREA_GROUPS[key].label} (whole group)` } : { topic: key, name: AREAS[key]?.label ?? key };

// Topic keys from keys or names ("rag", "Retrieval-augmented generation", "Language models").
function resolveTopics(list: unknown): { keys: string[]; unknown: string[] } {
  const keys: string[] = [];
  const unknown: string[] = [];
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  for (const raw of Array.isArray(list) ? list : []) {
    const q = norm(String(raw));
    const hit =
      Object.keys(AREA_GROUPS).find((k) => norm(k) === q || norm(AREA_GROUPS[k].label) === q) ??
      Object.keys(AREAS).find((k) => norm(k) === q || norm(AREAS[k].label) === q);
    if (hit) keys.push(hit);
    else unknown.push(String(raw));
  }
  return { keys, unknown };
}

export async function interestsForAgents(agent: Agent) {
  const prefs = await loadPrefs(adminClient(), agent.owner_id);
  return {
    following: (prefs?.areas ?? []).map(topic),
    venues: prefs?.venues ?? [],
    note: "Use update_my_interests with topic keys or names from available_topics. For you also learns from what your reader votes on, comments on and reads.",
    available_topics: Object.entries(AREA_GROUPS).map(([key, g]) => ({
      group: key,
      name: g.label,
      topics: Object.entries(g.areas).map(([k, label]) => ({ topic: k, name: label })),
    })),
  };
}

export async function updateInterestsForAgents(agent: Agent, args: Record<string, unknown>) {
  const db = adminClient();
  const prefs = await loadPrefs(db, agent.owner_id);
  const add = resolveTopics(args.add);
  const remove = resolveTopics(args.remove);
  const areas = [...new Set([...(prefs?.areas ?? []), ...add.keys])].filter((k) => !remove.keys.includes(k));
  const venues = Array.isArray(args.venues) ? args.venues.map(String).slice(0, 20) : (prefs?.venues ?? []);
  if (areas.length > 60) throw new AgentError("That's too many topics; keep it under 60.");
  const { error } = await db.from("reader_prefs").upsert(
    { user_id: agent.owner_id, areas, venues, name: prefs?.name ?? null, institution: prefs?.institution ?? null, updated_at: new Date().toISOString() },
    { onConflict: "user_id" },
  );
  if (error) throw new AgentError(`Couldn't save: ${error.message}`, 500);
  return {
    following: areas.map(topic),
    venues,
    ...(add.unknown.length || remove.unknown.length ? { not_recognized: [...add.unknown, ...remove.unknown] } : {}),
  };
}

export async function digestForAgents(agent: Agent, limit = 8) {
  const db = adminClient();
  const n = Math.max(1, Math.min(DIGEST.max, Math.round(limit) || 8));
  const { papers, hasTopics } = await rankForYou(db, agent.owner_id, n);
  if (!hasTopics)
    return { papers: [], note: "Your reader doesn't follow any topics yet. Ask what they work on, then call update_my_interests." };
  const followed = new Set((await loadPrefs(db, agent.owner_id))?.areas ?? []);
  return {
    date: new Date().toISOString().slice(0, 10),
    for_reader: agent.owner_name,
    papers: papers.map((s) => ({
      paper_id: s.id,
      title: s.title,
      authors: s.authors.slice(0, 6),
      venue: s.venue,
      published_on: s.published_on,
      topic: s.area ? AREAS[s.area]?.label ?? s.area : null,
      in_followed_topics: !!s.area && (followed.has(s.area) || followed.has(AREAS[s.area]?.group ?? "")),
      score: pct(s.score),
      verdict: tierOf(s)?.label ?? null,
      tldr: s.tldr,
      panel_consensus: s.panel_consensus,
      hf_upvotes: s.hf_upvotes,
      comments: s.comments,
      url: `${SITE_URL}/paper/${s.id}`,
    })),
    how_to_use: "Summarize these for your reader: what each paper does and why it may matter to them. Use get_paper for abstracts.",
  };
}
