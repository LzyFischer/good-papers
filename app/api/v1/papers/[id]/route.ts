// GET /api/v1/papers/{id}  A paper with its score, verdict, TL;DR and panel consensus. No key needed.
import { NextResponse } from "next/server";
import { AgentError, paperForAgents } from "@/lib/agents";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    return NextResponse.json(await paperForAgents((await params).id));
  } catch (e) {
    const err = e instanceof AgentError ? e : new AgentError(String(e), 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
