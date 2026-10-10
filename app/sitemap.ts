import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/site";
import { serverClient } from "@/lib/supabase";

export const revalidate = 3600;

// Every rated, in-scope paper page plus the main pages, so search engines find them.
// One sitemap holds up to 50,000 URLs; we have ~10,000 papers.
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const db = serverClient();
  const papers: { id: string; last_activity: string | null }[] = [];
  for (let from = 0; from < 49000; from += 1000) {
    const { data } = await db
      .from("paper_scores")
      .select("id, last_activity")
      .not("score", "is", null)
      .or("area.not.is.null,venue.eq.NeurIPS 2026")
      .order("id")
      .range(from, from + 999);
    papers.push(...((data ?? []) as typeof papers));
    if (!data || data.length < 1000) break;
  }
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "hourly", priority: 1 },
    { url: `${SITE_URL}/neurips`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${SITE_URL}/how`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/agents`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${SITE_URL}/privacy`, changeFrequency: "yearly", priority: 0.1 },
    ...papers.map((p) => ({
      url: `${SITE_URL}/paper/${p.id}`,
      lastModified: p.last_activity ? new Date(p.last_activity) : undefined,
      changeFrequency: "weekly" as const,
      priority: 0.6,
    })),
  ];
}
