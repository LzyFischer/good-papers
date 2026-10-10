import type { Metadata } from "next";
import Link from "next/link";
import { ForYouPage } from "@/components/ForYouPage";

export const metadata: Metadata = { title: "For you", robots: { index: false, follow: false } };

export default function ForYou() {
  return (
    <main className="wrap page">
      <div className="section-head">
        <h1 className="page-title">For you</h1>
        <Link href="/welcome?edit=1&next=/for-you">Edit topics</Link>
      </div>
      <p className="page-sub">What&apos;s hot right now, picked for your topics and what you read.</p>
      <ForYouPage />
    </main>
  );
}
