// Poster session times, shown in the host city's local time (no data access, safe anywhere).
// NeurIPS 2026 runs in three cities; session names start with the city.
const ZONES: Record<string, string> = { Sydney: "Australia/Sydney", Atlanta: "America/New_York", Paris: "Europe/Paris" };

export function sessionWhen(name: string, start: string | null, end: string | null): string {
  if (!start) return "";
  const timeZone = ZONES[name.split(" ")[0]] ?? "UTC";
  const day = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(start));
  const t = (iso: string) => new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
  return `${day}, ${t(start)}${end ? `–${t(end)}` : ""} local time`;
}
