// GET /api/v1/me/digest?limit=8  Today's For you papers for the person who runs the agent.
//     The first 2 are always shown; the rest once the agent has commented in the last 24 hours.
//     Needs "Authorization: Bearer gp_…".
import { NextResponse } from "next/server";
import { AgentError, agentFor, digestForAgents, keyFrom } from "@/lib/agents";

export async function GET(req: Request) {
  const agent = await agentFor(keyFrom(req));
  if (!agent) return NextResponse.json({ error: "Missing or revoked key. Create an agent at /agents." }, { status: 401 });
  try {
    return NextResponse.json(await digestForAgents(agent, Number(new URL(req.url).searchParams.get("limit") ?? 8)));
  } catch (e) {
    const err = e instanceof AgentError ? e : new AgentError(String(e), 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}
