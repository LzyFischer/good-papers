import type { Metadata } from "next";
import Link from "next/link";
import { AuthButton } from "@/components/AuthButton";
import { GateRevealer } from "@/components/GateRevealer";
import { Notifications } from "@/components/Notifications";
import { Onboarding } from "@/components/Onboarding";
import { Icon, IconSprite } from "@/components/Icons";
import { SearchForm } from "@/components/SearchForm";
import { SITE_URL } from "@/lib/site";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: "Good Papers: read the good ones", template: "%s | Good Papers" },
  description:
    "Which ML papers are worth reading? Readers rate them, a 20-reviewer AI panel weighs in from day one, and NeurIPS 2026 is rated session by session.",
  alternates: { canonical: "/" },
  openGraph: { siteName: "Good Papers", type: "website" },
  twitter: { card: "summary_large_image" },
  verification: process.env.GOOGLE_SITE_VERIFICATION ? { google: process.env.GOOGLE_SITE_VERIFICATION } : undefined,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700;12..96,800&family=Public+Sans:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <IconSprite />
        <header className="top">
          <div className="top-in">
            <Link href="/" className="brand">
              <Icon name="brand" />
              Good Papers
            </Link>
            <nav className="nav" aria-label="Sections">
              <Link href="/neurips">NeurIPS 2026</Link>
              <Link href="/how">How it works</Link>
            </nav>
            <SearchForm />
            <Notifications />
            <GateRevealer />
            <Onboarding />
            <AuthButton />
          </div>
        </header>
        {children}
        <footer className="foot wrap">
          Paper data from <a href="https://openalex.org">OpenAlex</a>, arXiv and Hugging Face. AI panel verdicts by Jev;
          AI comments, TL;DRs and consensus lines by a language model. <a href="/how">How scores work</a> ·{" "}
          <a href="/privacy">Privacy</a>.
        </footer>
      </body>
    </html>
  );
}
