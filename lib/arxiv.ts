// arXiv's own categories, which authors pick when submitting. OpenAlex's topic
// tags are model-assigned and let physics or math papers into the AI feed, so
// the daily feed keeps only papers with an ML-related arXiv category (primary or
// cross-listed: an LLM-agents paper filed under cs.SE is usually cross-listed to cs.AI).
import type { Paper } from "./types";

export const ML_CATEGORIES = new Set([
  "cs.LG", "cs.AI", "cs.CL", "cs.CV", "cs.IR", "cs.MA", "cs.NE", "cs.RO", "cs.HC", "cs.SD",
  "stat.ML", "eess.AS", "eess.IV",
]);

const ARXIV_ID = /arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5})|10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5})/i;

export function arxivIdOf(url: string | null | undefined): string | null {
  const m = url?.match(ARXIV_ID);
  return m ? m[1] ?? m[2] : null;
}

export const isML = (cats: string[] | undefined) => (cats ?? []).some((c) => ML_CATEGORIES.has(c));

// All categories (primary first) for each arXiv id, one request per 100 ids.
export async function arxivCategories(ids: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const res = await fetch(
      `https://export.arxiv.org/api/query?id_list=${batch.join(",")}&max_results=${batch.length}`,
      { signal: AbortSignal.timeout(20000), cache: "no-store" },
    );
    if (!res.ok) throw new Error(`arXiv API failed (${res.status})`);
    const xml = await res.text();
    for (const entry of xml.split("<entry>").slice(1)) {
      const id = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(?:v\d+)?<\/id>/)?.[1];
      const primary = entry.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1];
      const all = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);
      if (id && primary) out.set(id, [primary, ...all.filter((c) => c !== primary)]);
    }
  }
  return out;
}

// Papers OpenAlex hasn't indexed yet (it runs a week or two behind arXiv) are
// stored under "arxiv-<id>". Once a paper is stored under either id, that id wins.
export const ARXIV_PAPER = /^arxiv-(\d{4}\.\d{4,5})$/;
export const arxivPaperId = (aid: string) => `arxiv-${aid}`;

const unxml = (s: string) =>
  s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

// Title, authors, abstract and categories straight from arXiv, 100 ids per request.
export async function getArxivPapers(ids: string[]): Promise<(Paper & { categories: string[] })[]> {
  const out: (Paper & { categories: string[] })[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 100) {
    const batch = unique.slice(i, i + 100);
    const res = await fetch(`https://export.arxiv.org/api/query?id_list=${batch.join(",")}&max_results=${batch.length}`, {
      signal: AbortSignal.timeout(20000),
      next: { revalidate: 86400 },
    });
    if (!res.ok) throw new Error(`arXiv API failed (${res.status})`);
    for (const entry of (await res.text()).split("<entry>").slice(1)) {
      const aid = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(?:v\d+)?<\/id>/)?.[1];
      const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
      if (!aid || !title || !/^\d{4}\.\d{4,5}$/.test(aid)) continue;
      const published = entry.match(/<published>(\d{4}-\d{2}-\d{2})/)?.[1] ?? null;
      const primary = entry.match(/<arxiv:primary_category[^>]*term="([^"]+)"/)?.[1];
      const all = [...entry.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);
      out.push({
        id: arxivPaperId(aid),
        title: unxml(title),
        authors: [...entry.matchAll(/<author>\s*<name>([\s\S]*?)<\/name>/g)].map((m) => unxml(m[1])),
        year: published ? Number(published.slice(0, 4)) : null,
        venue: "arXiv",
        url: `https://arxiv.org/abs/${aid}`,
        abstract: unxml(entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "") || null,
        orgs: [],
        tags: [],
        publishedOn: published,
        citedByCount: null,
        categories: primary ? [primary, ...all.filter((c) => c !== primary)] : all,
      });
    }
  }
  return out;
}
