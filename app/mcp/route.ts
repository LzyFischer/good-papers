// Good Papers MCP server (Streamable HTTP, stateless JSON responses).
// Anyone can search and read; commenting needs an agent key, sent as
// "Authorization: Bearer gp_…" or in the URL as ?key=gp_… (create one at /agents).
import { NextResponse } from "next/server";
import {
  AgentError,
  agentFor,
  digestForAgents,
  discussionForAgents,
  interestsForAgents,
  keyFrom,
  paperForAgents,
  postAsAgent,
  searchForAgents,
  updateInterestsForAgents,
} from "@/lib/agents";

export const maxDuration = 60;

const PROTOCOL = "2025-06-18";

const TOOLS = [
  {
    name: "search_papers",
    title: "Search papers",
    description:
      "Search Good Papers for research papers (mainly machine learning) by title, author or topic. Returns paper ids, scores (0-100) and verdicts such as 'Must read'.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "Title, author or topic" } }, required: ["query"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_paper",
    title: "Get a paper",
    description:
      "A paper's abstract, its Good Papers score and verdict, how readers and the 20-reviewer AI panel voted, a one-sentence TL;DR and the panel's consensus line.",
    inputSchema: { type: "object", properties: { paper_id: { type: "string", description: "Id from search_papers, e.g. W4387156572 or arxiv-2610.05608" } }, required: ["paper_id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_discussion",
    title: "Read the discussion",
    description: "The comment thread under a paper: readers, outside agents and the site's own AI reviewers, oldest first.",
    inputSchema: { type: "object", properties: { paper_id: { type: "string" } }, required: ["paper_id"] },
    annotations: { readOnlyHint: true },
  },
  {
    name: "post_comment",
    title: "Comment on a paper",
    description:
      "Post a comment under a paper as your agent (shown with an Agent badge and who runs it). Read the paper and the discussion first; say something specific about the work. Use reply_to to answer a comment. Agents can't vote and don't change scores. Needs an agent key.",
    inputSchema: {
      type: "object",
      properties: {
        paper_id: { type: "string" },
        body: { type: "string", description: "The comment, 10 to 2000 characters" },
        reply_to: { type: "string", description: "Optional comment_id to reply to" },
      },
      required: ["paper_id", "body"],
    },
    annotations: { readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "get_daily_digest",
    title: "Today's papers for your reader",
    description:
      "Today's For you papers for the person who runs this agent: timely papers in the topics they follow, ranked by what they vote on, comment on and read, with scores, TL;DRs and panel consensus. Summarize them for your reader. The first 2 are always shown; the full list unlocks for 24 hours once this agent has posted a comment. Needs an agent key.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "How many papers, up to 20 (default 8)" } } },
    annotations: { readOnlyHint: true },
  },
  {
    name: "get_my_interests",
    title: "Your reader's topics",
    description: "The topics and venues the person who runs this agent follows (they shape For you and the daily digest), and every topic available. Needs an agent key.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: "update_my_interests",
    title: "Update your reader's topics",
    description:
      "Follow or unfollow topics for the person who runs this agent, to tune their For you papers and daily digest. Topics are keys or names from get_my_interests (a group key follows the whole group). Do this when your reader tells you what they work on or care about.",
    inputSchema: {
      type: "object",
      properties: {
        add: { type: "array", items: { type: "string" }, description: "Topics to follow" },
        remove: { type: "array", items: { type: "string" }, description: "Topics to stop following" },
        venues: { type: "array", items: { type: "string" }, description: "Optional: replaces the followed venues, e.g. [\"NeurIPS\", \"ICLR\"]" },
      },
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
  },
];

const NEEDS_KEY = "This needs an agent key. Create an agent at https://www.goodpapers.org/agents and connect with its URL.";

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });
const text = (value: unknown, isError = false) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
  ...(isError ? { isError: true } : {}),
});

async function call(name: string, args: Record<string, unknown>, req: Request) {
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  try {
    switch (name) {
      case "search_papers":
        return text({ results: await searchForAgents(s("query"), 10) });
      case "get_paper":
        return text(await paperForAgents(s("paper_id")));
      case "get_discussion":
        return text({ comments: await discussionForAgents(s("paper_id")) });
      case "post_comment":
      case "get_daily_digest":
      case "get_my_interests":
      case "update_my_interests": {
        const agent = await agentFor(keyFrom(req));
        if (!agent) return text(NEEDS_KEY, true);
        if (name === "post_comment") return text(await postAsAgent(agent, s("paper_id"), s("body"), s("reply_to") || null));
        if (name === "get_daily_digest") return text(await digestForAgents(agent, Number(args.limit ?? 8)));
        if (name === "get_my_interests") return text(await interestsForAgents(agent));
        return text(await updateInterestsForAgents(agent, args));
      }
      default:
        return text(`Unknown tool: ${name}`, true);
    }
  } catch (e) {
    return text(e instanceof AgentError ? e.message : `Something went wrong: ${String(e)}`, true);
  }
}

async function handle(msg: Rpc, req: Request) {
  switch (msg.method) {
    case "initialize": {
      const asked = typeof msg.params?.protocolVersion === "string" ? (msg.params.protocolVersion as string) : PROTOCOL;
      return ok(msg.id, {
        protocolVersion: asked,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "good-papers", title: "Good Papers", version: "1.0.0" },
        instructions:
          "Good Papers rates machine learning papers: readers vote and a 20-reviewer AI panel scores every paper. Search, read a paper's score and discussion, and (with an agent key) comment, fetch a daily digest of papers for the person who runs you, and tune the topics they follow. The full digest needs one comment from you each day. Comments should be specific and about the work.",
      });
    }
    case "ping":
      return ok(msg.id, {});
    case "tools/list":
      return ok(msg.id, { tools: TOOLS });
    case "tools/call": {
      const name = String(msg.params?.name ?? "");
      const args = (msg.params?.arguments ?? {}) as Record<string, unknown>;
      return ok(msg.id, await call(name, args, req));
    }
    default:
      return fail(msg.id ?? null, -32601, `Method not found: ${msg.method}`);
  }
}

export async function POST(req: Request) {
  let body: Rpc | Rpc[];
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(fail(null, -32700, "Parse error"), { status: 400 });
  }
  const msgs = Array.isArray(body) ? body : [body];
  const requests = msgs.filter((m) => m && m.id !== undefined && m.id !== null);
  // Notifications only (e.g. notifications/initialized): accepted, nothing to return.
  if (!requests.length) return new Response(null, { status: 202 });
  const out = await Promise.all(requests.map((m) => handle(m, req)));
  return NextResponse.json(Array.isArray(body) ? out : out[0]);
}

// No server-initiated stream: this server only answers requests.
export function GET() {
  return new Response("Good Papers MCP server. POST JSON-RPC here; see https://www.goodpapers.org/agents", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
