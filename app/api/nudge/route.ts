// Called after a reader posts a comment: wakes the worker if there is something
// for it to answer, so AI replies arrive in minutes, not hours.
import { NextResponse } from "next/server";
import { nudgeWorker } from "@/lib/dispatch";
import { serverClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export async function POST() {
  const { count } = await serverClient()
    .from("comments")
    .select("id", { count: "exact", head: true })
    .eq("author_kind", "user")
    .gte("created_at", new Date(Date.now() - 15 * 60_000).toISOString());
  if (!count) return NextResponse.json({ nudged: false });
  return NextResponse.json({ nudged: await nudgeWorker() });
}
