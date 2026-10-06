// arXiv's own categories, which authors pick when submitting. OpenAlex's topic
// tags are model-assigned and let physics or math papers into the AI feed, so
// the daily feed keeps only papers with an ML-related arXiv category (primary or
// cross-listed: an LLM-agents paper filed under cs.SE is usually cross-listed to cs.AI).

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
