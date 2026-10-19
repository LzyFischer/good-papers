// Authors claim their papers through ORCID (server only). The reader signs in with ORCID
// (OAuth, scope /authenticate), which proves the iD is theirs; we then read the works on
// their public ORCID record and on their OpenAlex profile, and claim the ones we have.
// Needs ORCID_CLIENT_ID and ORCID_CLIENT_SECRET (a free "Public API" client, orcid.org/developer-tools).
import { createHmac, randomBytes, timingSafeEqual } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { arxivIdOf } from "./arxiv";
import { storedIdsByArxiv } from "./papers";

const ORCID = "https://orcid.org";
const PUB = "https://pub.orcid.org/v3.0";

export const orcidConfigured = () => Boolean(process.env.ORCID_CLIENT_ID && process.env.ORCID_CLIENT_SECRET);

// The OAuth state carries the Good Papers user id, signed, and expires in 15 minutes.
function sign(payload: string) {
  return createHmac("sha256", process.env.ORCID_CLIENT_SECRET!).update(payload).digest("base64url");
}
export function makeState(userId: string, back: string) {
  const payload = Buffer.from(JSON.stringify({ u: userId, b: back, e: Date.now() + 15 * 60_000, n: randomBytes(6).toString("hex") })).toString("base64url");
  return `${payload}.${sign(payload)}`;
}
export function readState(state: string): { userId: string; back: string } | null {
  const [payload, mac] = state.split(".");
  if (!payload || !mac) return null;
  const want = Buffer.from(sign(payload));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const s = JSON.parse(Buffer.from(payload, "base64url").toString()) as { u: string; b: string; e: number };
    if (Date.now() > s.e) return null;
    return { userId: s.u, back: s.b.startsWith("/") && !s.b.startsWith("//") ? s.b : "/me" };
  } catch {
    return null;
  }
}

export function authorizeUrl(redirectUri: string, state: string) {
  const p = new URLSearchParams({ client_id: process.env.ORCID_CLIENT_ID!, response_type: "code", scope: "/authenticate", redirect_uri: redirectUri, state });
  return `${ORCID}/oauth/authorize?${p}`;
}

// The code from ORCID's redirect, exchanged for the reader's iD and name.
export async function exchangeCode(code: string, redirectUri: string): Promise<{ orcid: string; name: string | null }> {
  const res = await fetch(`${ORCID}/oauth/token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.ORCID_CLIENT_ID!,
      client_secret: process.env.ORCID_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`ORCID token exchange failed (${res.status})`);
  const j = (await res.json()) as { orcid?: string; name?: string };
  if (!j.orcid || !/^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/.test(j.orcid)) throw new Error("ORCID didn't return an iD");
  return { orcid: j.orcid, name: j.name?.trim() || null };
}

type Ids = { arxiv: Set<string>; doi: Set<string>; openalex: Set<string>; openalexAuthor: string | null };

// arXiv ids and DOIs on the public ORCID record.
async function orcidWorks(orcid: string, ids: Ids) {
  const res = await fetch(`${PUB}/${orcid}/works`, { headers: { Accept: "application/json" } });
  if (!res.ok) return;
  const j = (await res.json()) as { group?: { "external-ids"?: { "external-id"?: { "external-id-type": string; "external-id-value": string }[] } }[] };
  for (const g of j.group ?? []) {
    for (const x of g["external-ids"]?.["external-id"] ?? []) {
      const v = x["external-id-value"]?.trim();
      if (!v) continue;
      if (x["external-id-type"] === "arxiv") ids.arxiv.add(v.replace(/^arxiv:/i, "").replace(/v\d+$/, ""));
      if (x["external-id-type"] === "doi") {
        const doi = v.toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "");
        ids.doi.add(doi);
        const m = doi.match(/^10\.48550\/arxiv\.(\d{4}\.\d{4,5})/); // arXiv's own DOIs
        if (m) ids.arxiv.add(m[1]);
      }
    }
  }
}

// The reader's works on OpenAlex (whose author profiles carry ORCID iDs), newest first.
async function openalexWorks(orcid: string, ids: Ids) {
  const mailto = process.env.OPENALEX_MAILTO ? `&mailto=${encodeURIComponent(process.env.OPENALEX_MAILTO)}` : "";
  const a = await fetch(`https://api.openalex.org/authors/orcid:${orcid}?select=id${mailto}`);
  if (!a.ok) return;
  const author = ((await a.json()) as { id?: string }).id?.replace("https://openalex.org/", "") ?? null;
  if (!author) return;
  ids.openalexAuthor = author;
  const w = await fetch(
    `https://api.openalex.org/works?filter=author.id:${author}&sort=publication_date:desc&per-page=200&select=id,doi,ids${mailto}`,
  );
  if (!w.ok) return;
  const j = (await w.json()) as { results?: { id: string; doi?: string | null; ids?: { arxiv?: string } }[] };
  for (const r of j.results ?? []) {
    ids.openalex.add(r.id.replace("https://openalex.org/", ""));
    if (r.doi) ids.doi.add(r.doi.toLowerCase().replace(/^https?:\/\/doi\.org\//, ""));
    const ax = r.ids?.arxiv ? arxivIdOf(r.ids.arxiv) : null;
    if (ax) ids.arxiv.add(ax);
  }
}

// Claim every paper we hold that's on the reader's ORCID record or OpenAlex profile.
// Returns how many papers are claimed now.
export async function syncClaims(db: SupabaseClient, userId: string, orcid: string): Promise<{ claimed: number; openalexId: string | null }> {
  const ids: Ids = { arxiv: new Set(), doi: new Set(), openalex: new Set(), openalexAuthor: null };
  await Promise.all([orcidWorks(orcid, ids).catch(() => {}), openalexWorks(orcid, ids).catch(() => {})]);

  const ours = new Map<string, "orcid" | "openalex">();
  // OpenAlex works we store under their W id.
  const oa = [...ids.openalex];
  for (let i = 0; i < oa.length; i += 100) {
    const { data } = await db.from("papers").select("id").in("id", oa.slice(i, i + 100));
    for (const p of data ?? []) ours.set(p.id, "openalex");
  }
  // arXiv papers, under whichever id we store them.
  const stored = await storedIdsByArxiv([...ids.arxiv]).catch(() => new Map<string, string>());
  for (const id of stored.values()) if (!ours.has(id)) ours.set(id, "orcid");

  const rows = [...ours].map(([paper_id, source]) => ({ user_id: userId, paper_id, source }));
  if (rows.length) await db.from("paper_claims").upsert(rows, { onConflict: "user_id,paper_id", ignoreDuplicates: true });
  await db.from("orcid_accounts").update({ synced_at: new Date().toISOString(), openalex_id: ids.openalexAuthor }).eq("user_id", userId);
  const { count } = await db.from("paper_claims").select("paper_id", { count: "exact", head: true }).eq("user_id", userId);
  return { claimed: count ?? rows.length, openalexId: ids.openalexAuthor };
}
