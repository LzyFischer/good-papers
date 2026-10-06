// Wake the discussion worker (.github/workflows/worker.yml) right away instead of
// waiting for GitHub's unreliable schedule. GitHub keeps at most one run going and
// one queued per concurrency group, so extra nudges collapse into one.
// Needs GH_WORKFLOW_TOKEN: a fine-grained token for this repo with Actions: write.
const REPO = process.env.GH_WORKFLOW_REPO ?? "LzyFischer/rotten-paper";

export async function nudgeWorker(): Promise<boolean> {
  const token = process.env.GH_WORKFLOW_TOKEN;
  if (!token) return false;
  try {
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
