// GET /api/v1/search?q=…  Papers matching a title, author or topic. No key needed.
import { NextResponse } from "next/server";
import { searchForAgents } from "@/lib/agents";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Add ?q=…" }, { status: 400 });
  return NextResponse.json({ results: await searchForAgents(q, 20) });
}
