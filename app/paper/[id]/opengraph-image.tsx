// Share card: the picture Twitter, Slack, WeChat and friends show for a paper link,
// also downloadable from the Share button. Score, verdict, title and one line of the
// discussion, on the home page's dark background.
import { ImageResponse } from "next/og";
import { tierOf } from "@/components/Score";
import { getPaperAnywhere, getScores } from "@/lib/papers";
import { isPreprint, venueLabel } from "@/lib/orgs";
import { SITE_URL } from "@/lib/site";
import { tex } from "@/lib/latex";

export const alt = "Good Papers rating";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The brand ring (components/Icons.tsx), as an image the renderer can draw.
const BRAND = `data:image/svg+xml;base64,${Buffer.from(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><circle cx="24" cy="24" r="19" fill="none" stroke="#2b2f36" stroke-width="7"/><circle cx="24" cy="24" r="19" fill="none" stroke="#d2f54a" stroke-width="7" stroke-linecap="round" stroke-dasharray="102 200" transform="rotate(-90 24 24)"/><path d="M16.5 24.5l5.2 5.2 10-11" fill="none" stroke="#f6f5f2" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
).toString("base64")}`;

const TONES = { 5: "#6cc46c", 4: "#4cb8dc", 3: "#8f95ee", 2: "#c58ad2", 1: "#a3a8b4" } as Record<number, string>;
// Cut at a word boundary.
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n).replace(/\s+\S*$/, "").replace(/[,;:.]$/, "")}…` : s);

// The site's fonts from Google Fonts, as WOFF/TTF (the image renderer can't read WOFF2).
async function font(family: string, weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weight}`, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; U; Intel Mac OS X 10_6_8; de-at) AppleWebKit/533.21.1 Safari/533.21.1" },
      next: { revalidate: 604800 },
    })).text();
    // One @font-face per character subset; Latin comes last.
    const url = [...css.matchAll(/src: url\((.+?)\) format\('(?:woff|truetype|opentype)'\)/g)].at(-1)?.[1];
    return url ? await (await fetch(url, { next: { revalidate: 604800 } })).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [paper, scores, display, body] = await Promise.all([
    getPaperAnywhere(id).catch(() => null),
    getScores([id]).catch(() => new Map()),
    font("Bricolage Grotesque", 800),
    font("Public Sans", 500),
  ]);
  const score = scores.get(id) ?? null;
  const t = tierOf(score);
  const tone = t ? TONES[t.tone] : "#a3a7ae";
  const pct = t?.pct ?? 0;
  const r = 92;
  const c = 2 * Math.PI * r;
  const line = score?.panel_consensus ?? score?.tldr ?? null;
  const venue = paper?.venue && !isPreprint(paper.venue) ? venueLabel(paper.venue, paper.year) : null;
  const track = score?.conf_track && score.conf_track !== "poster" ? (score.conf_track === "oral" ? "Oral" : "Spotlight") : null;

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: "#111316", color: "#f4f1ea", padding: "56px 64px", fontFamily: "Public Sans" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 30 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontFamily: "Bricolage Grotesque" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={BRAND} width={42} height={42} alt="" />
            Good Papers
          </div>
          {(venue || track) && (
            <div style={{ display: "flex", gap: 10, fontSize: 24 }}>
              {venue && <div style={{ padding: "6px 14px", borderRadius: 8, background: "#f4f1ea", color: "#111316", fontWeight: 700 }}>{venue}</div>}
              {track && <div style={{ padding: "6px 14px", borderRadius: 8, background: "#d2f54a", color: "#14161a", fontWeight: 700 }}>{track}</div>}
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 48, marginTop: 44, flex: 1 }}>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 230 }}>
            <div style={{ position: "relative", width: 220, height: 220, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <svg width="220" height="220" viewBox="0 0 220 220" style={{ position: "absolute", top: 0, left: 0 }}>
                <circle cx="110" cy="110" r={r} fill="none" stroke="#2a2e35" strokeWidth="22" />
                <circle cx="110" cy="110" r={r} fill="none" stroke={tone} strokeWidth="22" strokeLinecap="round"
                  strokeDasharray={`${(pct / 100) * c} ${c}`} transform="rotate(-90 110 110)" />
              </svg>
              <div style={{ fontSize: 64, fontFamily: "Bricolage Grotesque", color: tone }}>{t ? `${pct}%` : "?"}</div>
            </div>
            <div style={{ fontSize: 30, fontFamily: "Bricolage Grotesque", marginTop: 16, color: tone }}>{t?.label ?? "Not rated yet"}</div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 22 }}>
            <div style={{ fontSize: 50, fontFamily: "Bricolage Grotesque", lineHeight: 1.1, letterSpacing: -1 }}>{clip(tex(paper?.title) || "A research paper", 110)}</div>
            {line && <div style={{ fontSize: 27, lineHeight: 1.4, color: "#a3a7ae" }}>{`“${clip(line, 170)}”`}</div>}
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: "#a3a7ae" }}>
          <div style={{ display: "flex" }}>
            {score?.ai_total ? `${score.ai_fresh} of ${score.ai_total} AI reviewers recommend it` : ""}
          </div>
          <div style={{ display: "flex", color: "#d2f54a" }}>{SITE_URL.replace(/^https?:\/\/(www\.)?/, "")}</div>
        </div>
      </div>
    ),
    {
      ...size,
      // Rendering a card takes real CPU, and link previews ask for the same one again and
      // again: Vercel's CDN keeps each for a day (scores move slowly), then refreshes it.
      headers: { "Cache-Control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800" },
      // Without either font, fall back to the renderer's built-in one.
      ...(display && body
        ? { fonts: [{ name: "Bricolage Grotesque", data: display, weight: 800 as const }, { name: "Public Sans", data: body, weight: 500 as const }] }
        : {}),
    },
  );
}
