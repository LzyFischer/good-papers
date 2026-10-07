// Semantic Scholar search. It indexes arXiv within a day, while OpenAlex runs a
// week or two behind, so search asks both. Needs S2_API_KEY: without a key every
// request shares one public pool and is nearly always rate-limited, so we skip it.
import { arxivPaperId } from "./arxiv";
import type { Paper } from "./types";

const FIELDS = "title,authors,year,venue,externalIds,abstract,publicationDate,citationCount";

export const s2Configured = () => Boolean(process.env.S2_API_KEY);

/* eslint-disable @typescript-eslint/no-explicit-any */
// Only results with an arXiv id: anything else OpenAlex already has.
export async function searchS2(query: string): Promise<Paper[]> {
  if (!s2Configured()) return [];
  const p = new URLSearchParams({ query, limit: "20", fields: FIELDS });
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?${p}`, {
    headers: { "x-api-key": process.env.S2_API_KEY! },
    signal: AbortSignal.timeout(8000),
    next: { revalidate: 3600 },
  });
  if (!res.ok) throw new Error(`Semantic Scholar search failed (${res.status})`);
  const data = await res.json();
  return (data.data ?? [])
    .filter((w: any) => /^\d{4}\.\d{4,5}$/.test(w.externalIds?.ArXiv ?? ""))
    .map((w: any): Paper => {
      const aid = w.externalIds.ArXiv as string;
      return {
        id: arxivPaperId(aid),
        title: w.title ?? "Untitled",
        authors: (w.authors ?? []).map((a: any) => a.name).filter(Boolean),
        year: w.year ?? null,
        venue: w.venue && !/arxiv/i.test(w.venue) ? w.venue : "arXiv",
        url: `https://arxiv.org/abs/${aid}`,
        abstract: w.abstract ?? null,
        orgs: [],
        tags: [],
        publishedOn: w.publicationDate ?? null,
        citedByCount: typeof w.citationCount === "number" ? w.citationCount : null,
      };
    });
}
/* eslint-enable @typescript-eslint/no-explicit-any */
