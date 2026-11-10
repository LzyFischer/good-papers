// GET /api/paper-preview/<id>: a paper we haven't stored yet, fetched from OpenAlex or arXiv
// for components/UnstoredPaper.tsx. Paper pages of unstored papers are an empty shell that
// loads this in the browser, so crawlers that don't run JavaScript (they used to walk
// author and paper links into OpenAlex's millions of works) never reach OpenAlex or the database.
import { NextResponse } from "next/server";
import { arxivIdOf } from "@/lib/arxiv";
import { getPaperAnywhere, PAPER_ID, storedIdsByArxiv } from "@/lib/papers";

export const revalidate = 3600;

const BOT = /bot|crawl|spider|slurp|headless|lightpanda|python|curl|wget|httpx|axios|scrapy|go-http/i;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!PAPER_ID.test(id) || BOT.test(req.headers.get("user-agent") ?? "")) return NextResponse.json({ paper: null }, { status: 404 });
  const paper = await getPaperAnywhere(id).catch(() => null);
  if (!paper) return NextResponse.json({ paper: null }, { status: 404 });
  // The same arXiv paper already stored under its other id: the page goes there.
  const aid = arxivIdOf(paper.url);
  const stored = aid ? (await storedIdsByArxiv([aid]).catch(() => new Map<string, string>())).get(aid) : undefined;
  return NextResponse.json(
    { paper, redirect: stored && stored !== id ? stored : null },
    { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
  );
}
