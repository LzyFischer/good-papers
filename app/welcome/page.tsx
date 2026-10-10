import type { Metadata } from "next";
import { Welcome } from "@/components/Welcome";

export const metadata: Metadata = { title: "Your interests", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ next?: string; edit?: string }> };

export default async function WelcomePage({ searchParams }: Props) {
  const { next, edit } = await searchParams;
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="wrap page">
      <Welcome next={safe} edit={edit === "1"} />
    </main>
  );
}
