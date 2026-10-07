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

// --- Author, institution and topic pages: full lists from OpenAlex ---------

/* eslint-disable @typescript-eslint/no-explicit-any */
const PAGE_SIZE = 50;
const CS_FIELDS = new Set(["Computer Science", "Mathematics", "Engineering", "Decision Sciences"]);
export const normTitle = (s: string) =>
  s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const norm = normTitle;
const shortId = (id: string) => String(id).replace("https://openalex.org/", "");

async function oa(path: string, extra: Record<string, string>, select?: string): Promise<any> {
  const p = params(extra);
  if (select) p.set("select", select);
  const res = await fetch(`${BASE}${path}?${p}`, { next: { revalidate: 3600 } });
  if (!res.ok) throw new Error(`OpenAlex ${path} failed (${res.status})`);
  return res.json();
}

async function works(filter: string, page: number, extra: Record<string, string> = {}) {
  const data = await oa("/works", { filter, per_page: String(PAGE_SIZE), page: String(page), ...extra });
  return { papers: (data.results ?? []).map(toPaper) as Paper[], total: (data.meta?.count as number) ?? 0 };
}

// arXiv and published versions are separate OpenAlex works; keep the first (newest) of each title.
export function dedupeByTitle<T>(items: T[], title: (x: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((x) => {
    const k = normTitle(title(x));
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// OpenAlex often splits one person into several author records. Start from the
// record on the paper the reader clicked (when known), then merge same-name
// AI/CS records that share an institution with it; unrelated namesakes stay out.
export async function getAuthorWorks(name: string, fromWork: string | null, page = 1) {
  let primary: string | null = null;
  if (fromWork && /^W\d+$/.test(fromWork)) {
    const w = await oa(`/works/${fromWork}`, {}, "authorships").catch(() => null);
    const hit = (w?.authorships ?? []).find((a: any) => norm(a.author?.display_name ?? "") === norm(name));
    if (hit?.author?.id) primary = shortId(hit.author.id);
  }
  const res = await oa("/authors", { search: name, per_page: "25" },
    "id,display_name,display_name_alternatives,affiliations,last_known_institutions,topics,works_count");
  const same = (res.results ?? []).filter((a: any) => {
    const names = [a.display_name, ...(a.display_name_alternatives ?? [])].map(norm);
    const fields = (a.topics ?? []).slice(0, 5).map((t: any) => t.field?.display_name);
    return names.includes(norm(name)) && (fields.some((f: string) => CS_FIELDS.has(f)) || shortId(a.id) === primary);
  });
  if (!primary) primary = same.sort((a: any, b: any) => b.works_count - a.works_count)[0]?.id ?? null;
  if (!primary) return { name, institutions: [] as string[], records: 0, papers: [] as Paper[], total: 0 };
  primary = shortId(primary);
  // Institutions in the last 4 years only: big schools from a decade ago would pull in namesakes.
  const recent = new Date().getFullYear() - 4;
  const instOf = (a: any) =>
    new Set<string>([
      ...(a.last_known_institutions ?? []).map((i: any) => i.id),
      ...(a.affiliations ?? []).filter((x: any) => Math.max(...(x.years ?? [0])) >= recent).map((x: any) => x.institution?.id),
    ].filter(Boolean));
  const main = same.find((a: any) => shortId(a.id) === primary) ??
    (await oa(`/authors/${primary}`, {}, "id,display_name,affiliations,last_known_institutions"));
  // Merge only records sharing the clicked record's current institution.
  const mainInst = new Set<string>((main.last_known_institutions ?? []).map((i: any) => i.id));
  if (mainInst.size === 0) for (const i of instOf(main)) mainInst.add(i);
  const ids = [primary, ...same.filter((a: any) => shortId(a.id) !== primary && [...instOf(a)].some((i) => mainInst.has(i))).map((a: any) => shortId(a.id))].slice(0, 15);
  const institutions = (main.last_known_institutions ?? []).map((i: any) => i.display_name).filter(Boolean);

  // OpenAlex records can still lump several namesakes together. Keep the works
  // connected to the clicked paper through shared co-authors (grown iteratively),
  // which is how author disambiguation is usually done.
  const all: any[] = [];
  for (let pg = 1; pg <= 3; pg++) {
    const data = await oa("/works", { filter: `author.id:${ids.join("|")}`, sort: "publication_date:desc", per_page: "200", page: String(pg) });
    all.push(...(data.results ?? []));
    if ((data.results ?? []).length < 200) break;
  }
  const me = norm(name);
  const coauthorsOf = (w: any) =>
    (w.authorships ?? []).map((a: any) => norm(a.author?.display_name ?? "")).filter((n: string) => n && n !== me);
  let kept = all;
  const seed = fromWork ? all.find((w) => shortId(w.id) === fromWork) ?? (await oa(`/works/${fromWork}`, {}, "id,authorships").catch(() => null)) : null;
  if (seed) {
    const circle = new Set<string>(coauthorsOf(seed));
    const inCircle = new Set<string>([shortId(seed.id)]);
    for (let pass = 0; pass < 4; pass++) {
      let grew = false;
      for (const w of all) {
        if (inCircle.has(shortId(w.id))) continue;
        const co = coauthorsOf(w);
        if (co.some((n: string) => circle.has(n))) {
          inCircle.add(shortId(w.id));
          co.forEach((n: string) => circle.add(n));
          grew = true;
        }
      }
      if (!grew) break;
    }
    kept = all.filter((w) => inCircle.has(shortId(w.id)));
  }
  kept = dedupeByTitle(kept, (w) => w.display_name ?? "");
  const papers = kept.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(toPaper) as Paper[];
  return { name: main.display_name ?? name, institutions, records: ids.length, papers, total: kept.length };
}

export async function getInstitutionWorks(name: string, page = 1) {
  const res = await oa("/institutions", { search: name, per_page: "5" }, "id,display_name,country_code");
  const list = res.results ?? [];
  const inst = list.find((i: any) => norm(i.display_name) === norm(name)) ??
    list.find((i: any) => norm(i.display_name).includes(norm(name)) || norm(name).includes(norm(i.display_name)));
  if (inst) {
    const { papers, total } = await works(`institutions.id:${shortId(inst.id)}`, page, { sort: "publication_date:desc" });
    return { name: inst.display_name as string, matched: true, papers, total };
  }
  // Not a known institution (e.g. parsed from raw affiliation text): search raw affiliations.
  const { papers, total } = await works(`raw_affiliation_strings.search:${name.replace(/[,|]/g, " ")}`, page, {
    sort: "publication_date:desc",
  });
  return { name, matched: false, papers, total };
}

// Our areas aren't OpenAlex categories: search by the label, last two years, by relevance.
export async function searchTopicWorks(label: string, page = 1) {
  const since = new Date(Date.now() - 2 * 365 * 86400_000).toISOString().slice(0, 10);
  return works(`from_publication_date:${since}`, page, { search: label });
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// OpenAlex works for arXiv ids, via their arXiv DOIs (50 per request).
export async function getPapersByArxivIds(ids: string[]): Promise<Paper[]> {
  const out: Paper[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const dois = ids.slice(i, i + 50).map((id) => `10.48550/arxiv.${id}`).join("|");
    const res = await fetch(`${BASE}/works?${params({ filter: `doi:${dois}`, per_page: "50" })}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`OpenAlex arXiv lookup failed (${res.status})`);
    out.push(...((await res.json()).results ?? []).map(toPaper));
  }
  return out;
}
