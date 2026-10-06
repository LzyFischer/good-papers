// Full text for the AI panel: the introduction and conclusion, so Jev judges
// more than the abstract. Sources, in order:
//   1. arXiv HTML (clean section structure), via the arXiv id OpenAlex knows,
//      or an exact-title arXiv search when OpenAlex has no arXiv version;
//   2. an open-access PDF (arXiv, ACL Anthology, publisher) listed by OpenAlex.
// Returns null when nothing usable is found; the panel then reads the abstract only.
import { extractText, getDocumentProxy } from "unpdf";
import type { Paper } from "./types";

export type FullText = { source: string; introduction: string; conclusion: string | null };

const INTRO_WORDS = 1200;
const CONCLUSION_WORDS = 600;
const MAX_PDF_BYTES = 25_000_000;

function contact() {
  const mail = process.env.OPENALEX_MAILTO;
  return `GoodPapers/0.2${mail ? ` (mailto:${mail})` : ""}`;
}

async function get(url: string, ms: number): Promise<Response | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": contact() }, signal: AbortSignal.timeout(ms), cache: "no-store" });
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

const normTitle = (t: string) => t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const ARXIV_ABS = /arxiv\.org\/(?:abs|pdf|html)\/([0-9]{4}\.[0-9]{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/[0-9]{7})/i;
const ARXIV_DOI = /10\.48550\/arxiv\.([0-9]{4}\.[0-9]{4,5})/i;
const ACL_DOI = /10\.18653\/v1\/([^\s/]+)$/i;

type Sources = { arxivId: string | null; pdfUrls: string[] };

/* eslint-disable @typescript-eslint/no-explicit-any */
async function locate(paper: Pick<Paper, "id" | "title" | "url">): Promise<Sources> {
  let arxivId = paper.url?.match(ARXIV_ABS)?.[1] ?? null;
  const pdfUrls: string[] = [];

  if (/^W\d+$/.test(paper.id)) {
    const p = new URLSearchParams({ select: "doi,locations,best_oa_location" });
    if (process.env.OPENALEX_MAILTO) p.set("mailto", process.env.OPENALEX_MAILTO);
    if (process.env.OPENALEX_API_KEY) p.set("api_key", process.env.OPENALEX_API_KEY);
    const res = await get(`https://api.openalex.org/works/${paper.id}?${p}`, 8000);
    const w: any = res ? await res.json().catch(() => null) : null;
    const locs: any[] = [w?.best_oa_location, ...(w?.locations ?? [])].filter(Boolean);
    const dois = [w?.doi, ...locs.map((l) => l.landing_page_url)].filter(Boolean) as string[];
    for (const l of locs) {
      arxivId ??= String(l.landing_page_url ?? "").match(ARXIV_ABS)?.[1] ?? String(l.pdf_url ?? "").match(ARXIV_ABS)?.[1] ?? null;
      if (l.pdf_url) pdfUrls.push(l.pdf_url);
    }
    for (const d of dois) {
      arxivId ??= d.match(ARXIV_DOI)?.[1] ?? null;
      const acl = d.match(ACL_DOI)?.[1];
      if (acl) pdfUrls.push(`https://aclanthology.org/${acl}.pdf`);
    }
  }

  if (!arxivId) arxivId = await searchArxiv(paper.title);
  return { arxivId, pdfUrls: [...new Set(pdfUrls)] };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

// Exact-title match only, so we never read the wrong paper.
async function searchArxiv(title: string): Promise<string | null> {
  const q = `ti:"${title.replace(/["\\]/g, " ").slice(0, 200)}"`;
  const res = await get(`https://export.arxiv.org/api/query?search_query=${encodeURIComponent(q)}&max_results=5`, 8000);
  if (!res) return null;
  const xml = await res.text();
  for (const entry of xml.split("<entry>").slice(1)) {
    const id = entry.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(?:v\d+)?<\/id>/)?.[1];
    const t = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1];
    if (id && t && normTitle(t) === normTitle(title)) return id;
  }
  return null;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

// arXiv HTML (LaTeXML) → plain text with one line per heading/paragraph.
function htmlToText(html: string): string {
  return html
    .replace(/<(head|script|style|nav|footer|math|figure|table|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/h[1-6]|\/div|\/li|\/section)\b[^>]*>/gi, "\n")
    .replace(/<h[1-6]\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) =>
      e[0] === "#" ? String.fromCodePoint(parseInt(e.slice(e[1] === "x" ? 2 : 1), e[1] === "x" ? 16 : 10)) : ENTITIES[e.toLowerCase()] ?? m,
    )
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

async function pdfToText(url: string): Promise<string | null> {
  const res = await get(url, 15000);
  if (!res || !/pdf/i.test(res.headers.get("content-type") ?? "pdf")) return null;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_PDF_BYTES) return null;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(await res.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    return text;
  } catch {
    return null;
  }
}

// Section headings sit on their own line: "1 Introduction", "7. Conclusion", "IV Discussion".
const HEADING = /^(?:\d{1,2}|[IVX]{1,4})\.?\s+[A-Z][\w ,:&'’()\-]{2,80}$/;
const BARE_INTRO = /^introduction$/i;
const CONCLUSION = /conclu|discussion|summary|future work/i;
const REFERENCES = /^(?:\d{1,2}\.?\s+)?(references|bibliography)$/i;
const BACK_MATTER = /^(?:[A-Z]\.?\s+)?(acknowledge?ments?|appendix|limitations|ethics statement|impact statement)\b/i;

function clean(lines: string[], words: number): string {
  const text = lines
    .join("\n")
    .replace(/-\n(?=[a-z])/g, "")
    .replace(/\s*\n\s*/g, " ")
    .replace(/\((?:[^()]*?\b(?:19|20)\d{2}[a-z]?)(?:;[^()]*)*\)/g, "") // (Author et al., 2021; ...)
    .replace(/\[\d+(?:[,–-]\s*\d+)*\]/g, "") // [12], [3-5]
    .replace(/\s{2,}/g, " ")
    .trim();
  const w = text.split(" ");
  return w.length > words ? w.slice(0, words).join(" ") + " …" : text;
}

export function extractSections(text: string): { introduction: string; conclusion: string | null } | null {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const isHeading = (l: string) => HEADING.test(l) || BARE_INTRO.test(l) || REFERENCES.test(l) || BACK_MATTER.test(l);
  let refs = lines.length;
  for (let i = lines.length - 1; i > lines.length * 0.3; i--) if (REFERENCES.test(lines[i])) refs = i;

  const intro = lines.findIndex((l) => (HEADING.test(l) || BARE_INTRO.test(l)) && /introduction/i.test(l));
  if (intro < 0) return null;
  let introEnd = lines.findIndex((l, i) => i > intro && isHeading(l));
  if (introEnd < 0) introEnd = Math.min(lines.length, intro + 80);

  let concl = -1;
  for (let i = refs - 1; i > introEnd; i--) {
    if (HEADING.test(lines[i]) && CONCLUSION.test(lines[i])) {
      concl = i;
      break;
    }
  }
  let conclusion: string | null = null;
  if (concl > 0) {
    let end = lines.findIndex((l, i) => i > concl && isHeading(l));
    if (end < 0 || end > refs) end = refs;
    conclusion = clean(lines.slice(concl + 1, end), CONCLUSION_WORDS);
  }
  const introduction = clean(lines.slice(intro + 1, introEnd), INTRO_WORDS);
  return introduction.split(" ").length >= 80 ? { introduction, conclusion } : null;
}

export async function getFullText(paper: Pick<Paper, "id" | "title" | "url">): Promise<FullText | null> {
  const { arxivId, pdfUrls } = await locate(paper);

  if (arxivId) {
    const res = await get(`https://arxiv.org/html/${arxivId}`, 12000);
    const sections = res ? extractSections(htmlToText(await res.text())) : null;
    if (sections) return { source: `arxiv-html:${arxivId}`, ...sections };
    pdfUrls.unshift(`https://arxiv.org/pdf/${arxivId}`);
  }
  for (const url of pdfUrls.slice(0, 3)) {
    const text = await pdfToText(url);
    const sections = text ? extractSections(text) : null;
    if (sections) return { source: url, ...sections };
  }
  return null;
}
