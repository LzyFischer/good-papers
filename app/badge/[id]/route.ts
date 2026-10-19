// A small README badge for authors: "Good Papers | Must read", linking (from the snippet on
// the paper page) back to the paper. It shows the tier, not the percentage, which stays
// behind a vote on the site. Cached at the edge for an hour; GitHub proxies it anyway.
import { getScores, PAPER_ID } from "@/lib/papers";
import { TIERS } from "@/lib/types";

const TONE = ["#7a7f99", "#7a7f99", "#5a77a8", "#2f8c99", "#3f9a6b", "#b07d0a"]; // index = tier tone (Must read is gold)

// Rough width of Verdana 11px text, as shields-style badges measure it.
const width = (text: string) => Math.round(text.length * 6.6 + 14);

function svg(label: string, color: string) {
  const left = "Good Papers";
  const lw = width(left);
  const rw = width(label);
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="20" role="img" aria-label="${esc(left)}: ${esc(label)}">
<title>${esc(left)}: ${esc(label)}</title>
<clipPath id="r"><rect width="${lw + rw}" height="20" rx="4"/></clipPath>
<g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#14161a"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/></g>
<g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
<text x="${lw / 2}" y="14" fill="#d2f54a">${esc(left)}</text>
<text x="${lw + rw / 2}" y="14">${esc(label)}</text>
</g></svg>`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const id = (await params).id.replace(/\.svg$/, "");
  let label = "not rated yet";
  let color = "#7a7f99";
  if (PAPER_ID.test(id)) {
    const s = (await getScores([id]).catch(() => new Map())).get(id);
    if (s?.score !== null && s?.score !== undefined) {
      const tier = TIERS.find((t) => s.score >= t.min) ?? TIERS[TIERS.length - 1];
      label = tier.label;
      color = TONE[tier.tone];
    }
  }
  return new Response(svg(label, color), {
    headers: {
      "content-type": "image/svg+xml; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
