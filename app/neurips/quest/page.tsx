import type { Metadata } from "next";
import { NeuripsQuest } from "@/components/NeuripsQuest";
import { AREAS } from "@/lib/areas";
import { CITIES, questPapers, questSessions, type City } from "@/lib/quest";

export const metadata: Metadata = {
  title: "NeurIPS Quest",
  description: "Pick your topics and walk a pixel-art poster hall to the best-rated NeurIPS 2026 posters in every session.",
};

type Props = { searchParams: Promise<{ s?: string; city?: string }> };

export default async function QuestPage({ searchParams }: Props) {
  const { s, city: c } = await searchParams;
  const sessions = await questSessions();
  const city: City = CITIES.includes(c as City) ? (c as City) : sessions.find((x) => x.name === s)?.city ?? "Sydney";
  const inCity = sessions.filter((x) => x.city === city);
  // The asked-for session, else the one on now or next in this city, else its first.
  const now = new Date().toISOString();
  const session =
    sessions.find((x) => x.name === s && x.city === city) ??
    inCity.find((x) => (x.end ?? "") > now) ??
    inCity[0];
  const papers = session ? await questPapers(session.name) : [];
  const labels = Object.fromEntries([...new Set(papers.map((p) => p.a).filter(Boolean))].map((a) => [a, AREAS[a!]?.label ?? a]));
  return (
    <>
      <link
        rel="stylesheet"
        href="https://fonts.googleapis.com/css2?family=Press+Start+2P&family=VT323&display=swap"
        precedence="default" // React 19 hoists it into <head>
      />
      <NeuripsQuest city={city} sessions={sessions} session={session ?? null} papers={papers} labels={labels} />
    </>
  );
}
