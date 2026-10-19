"use client";
// Send a signed-in reader to ORCID; they come back to `back`.
export async function connectOrcid(token: string, back: string): Promise<string | null> {
  const r = await fetch("/api/orcid/start", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ back }),
  });
  const j = (await r.json().catch(() => ({}))) as { url?: string; error?: string };
  if (j.url) {
    window.location.href = j.url;
    return null;
  }
  return j.error ?? "Couldn't reach ORCID. Try again.";
}
