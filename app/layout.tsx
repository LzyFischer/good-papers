import type { Metadata } from "next";
import Link from "next/link";
import { AuthButton } from "@/components/AuthButton";
import { GateRevealer } from "@/components/GateRevealer";
import { Notifications } from "@/components/Notifications";
import { Icon, IconSprite } from "@/components/Icons";
import { SearchForm } from "@/components/SearchForm";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Good Papers: read the good ones", template: "%s | Good Papers" },
  description: "New ML papers, scored by the people who read them, with a 20-reviewer AI panel from day one.",
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
              <Link href="/#trending">Trending</Link>
              <Link href="/#must-read">Must read</Link>
              <Link href="/neurips">NeurIPS 2026</Link>
              <Link href="/ask">Ask</Link>
              <Link href="/how">How it works</Link>
            </nav>
            <SearchForm />
            <Notifications />
            <GateRevealer />
            <AuthButton />
          </div>
        </header>
        {children}
        <footer className="foot wrap">
          Paper data from <a href="https://openalex.org">OpenAlex</a>, arXiv and Hugging Face. AI panel verdicts by Jev;
          AI comments, TL;DRs and consensus lines by a language model. <a href="/how">How scores work</a>.
        </footer>
      </body>
    </html>
  );
}
