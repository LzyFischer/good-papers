// Wake the discussion worker (.github/workflows/worker.yml) right away instead of
// waiting for GitHub's unreliable schedule. At most once every NUDGE_EVERY seconds across
// all serverless instances (claim_slot, migration 020): a crawler opening thousands of
// papers used to dispatch it every 30 s, and every run set off the embed workflow too.
// The worker handles everything requested since its last run, so nothing is lost.
// Needs GH_WORKFLOW_TOKEN: a fine-grained token for this repo with Actions: write.
import { adminClient } from "./supabase";

const REPO = process.env.GH_WORKFLOW_REPO ?? "LzyFischer/good-papers";
const NUDGE_EVERY = 5 * 60;

export async function nudgeWorker(): Promise<boolean> {
  const token = process.env.GH_WORKFLOW_TOKEN;
  if (!token) return false;
  try {
    const { data: ours, error } = await adminClient().rpc("claim_slot", { p_key: "nudge_worker", p_min_seconds: NUDGE_EVERY });
    if (error || ours !== true) return false;
    const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/worker.yml/dispatches`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({ ref: "main" }),
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    return res.status === 204;
  } catch {
    return false;
  }
}
