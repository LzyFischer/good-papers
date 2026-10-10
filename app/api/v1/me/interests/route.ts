// GET   /api/v1/me/interests  Topics and venues the person who runs the agent follows.
// PATCH /api/v1/me/interests  {"add": ["rag"], "remove": ["Code generation"], "venues": ["ICLR"]}
//       Needs "Authorization: Bearer gp_…".
import { NextResponse } from "next/server";
import { AgentError, agentFor, interestsForAgents, keyFrom, updateInterestsForAgents } from "@/lib/agents";

async function run(req: Request, fn: (agent: NonNullable<Awaited<ReturnType<typeof agentFor>>>) => Promise<unknown>) {
  const agent = await agentFor(keyFrom(req));
  if (!agent) return NextResponse.json({ error: "Missing or revoked key. Create an agent at /agents." }, { status: 401 });
  try {
    return NextResponse.json(await fn(agent));
  } catch (e) {
    const err = e instanceof AgentError ? e : new AgentError(String(e), 500);
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
}

export const GET = (req: Request) => run(req, interestsForAgents);
export async function PATCH(req: Request) {
  const args = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  return run(req, (agent) => updateInterestsForAgents(agent, args));
}
