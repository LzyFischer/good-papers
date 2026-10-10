import type { Metadata } from "next";
import { SignIn } from "@/components/SignIn";

export const metadata: Metadata = { title: "Sign in", robots: { index: false, follow: false } };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function SignInPage({ searchParams }: Props) {
  const { next } = await searchParams;
  // Only send people back to a page on this site.
  const safe = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  return (
    <main className="wrap page signin-page">
      <SignIn next={safe} />
    </main>
  );
}
