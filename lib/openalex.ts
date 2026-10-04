import type { Paper } from "./types";

const BASE = "https://api.openalex.org";
const FIELDS =
  "id,display_name,authorships,publication_year,publication_date,primary_location,abstract_inverted_index,doi,cited_by_count";

// "Newest papers" feed: arXiv (S4306400194) papers in the Artificial Intelligence
// subfield (1702). Override with OPENALEX_NEWEST_FILTER if you want another slice.
const NEWEST_FILTER =
  process.env.OPENALEX_NEWEST_FILTER ?? "primary_location.source.id:S4306400194,primary_topic.subfield.id:1702";

function params(extra: Record<string, string>) {
  const p = new URLSearchParams({ ...extra, select: FIELDS });
  if (process.env.OPENALEX_MAILTO) p.set("mailto", process.env.OPENALEX_MAILTO);
  if (process.env.OPENALEX_API_KEY) p.set("api_key", process.env.OPENALEX_API_KEY);
  return p;
}

// OpenAlex stores abstracts as { word: [positions] }; rebuild the text.
function rebuildAbstract(inv?: Record<string, number[]> | null): string | null {
  if (!inv) return null;
  const words: string[] = [];
  for (const [word, positions] of Object.entries(inv)) {
    for (const pos of positions) words[pos] = word;
  }
  return words.join(" ").replace(/\s+/g, " ").trim() || null;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toPaper(w: any): Paper {
  const orgs = new Set<string>();
  for (const a of w.authorships ?? []) {
    for (const inst of a.institutions ?? []) if (inst.display_name) orgs.add(inst.display_name);
  }
  return {
    id: String(w.id).replace("https://openalex.org/", ""),
    title: w.display_name ?? "Untitled",
    authors: (w.authorships ?? []).map((a: any) => a.author?.display_name).filter(Boolean),
    year: w.publication_year ?? null,
    venue: w.primary_location?.source?.display_name ?? null,
    url: w.primary_location?.landing_page_url ?? w.doi ?? null,
    abstract: rebuildAbstract(w.abstract_inverted_index),
    orgs: [...orgs].slice(0, 8),
    tags: [],
    publishedOn: w.publication_date ?? null,
    citedByCount: typeof w.cited_by_count === "number" ? w.cited_by_count : null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function searchPapers(query: string): Promise<Paper[]> {
  const res = await fetch(`${BASE}/works?${params({ search: query, per_page: "20" })}`, {
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`OpenAlex search failed (${res.status})`);
  const data = await res.json();
  return (data.results ?? []).map(toPaper);
}

export async function getPaper(id: string): Promise<Paper | null> {
  if (!/^W\d+$/.test(id)) return null;
  const res = await fetch(`${BASE}/works/${id}?${params({})}`, { next: { revalidate: 86400 } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`OpenAlex lookup failed (${res.status})`);
  return toPaper(await res.json());
}

export async function getNewestPapers(days = 3, limit = 25): Promise<Paper[]> {
  const since = new Date(Date.now() - days * 86400_000).toISOString().slice(0, 10);
  const filter = `${NEWEST_FILTER},from_publication_date:${since},has_abstract:true`;
  const res = await fetch(
    `${BASE}/works?${params({ filter, sort: "publication_date:desc", per_page: String(limit) })}`,
    { cache: "no-store" },
  );
  if (!res.ok) throw new Error(`OpenAlex newest failed (${res.status}): ${await res.text()}`);
  const data = await res.json();
  return (data.results ?? []).map(toPaper);
}

// Current citation counts for OpenAlex ids (50 per request).
export async function getCitationCounts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const works = ids.filter((id) => /^W\d+$/.test(id));
  for (let i = 0; i < works.length; i += 50) {
    const batch = works.slice(i, i + 50);
    const p = params({ filter: `openalex_id:${batch.join("|")}`, per_page: "50" });
    p.set("select", "id,cited_by_count");
    const res = await fetch(`${BASE}/works?${p}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`OpenAlex citations failed (${res.status})`);
    const data = await res.json();
    for (const w of data.results ?? []) out.set(String(w.id).replace("https://openalex.org/", ""), w.cited_by_count ?? 0);
  }
  return out;
}
