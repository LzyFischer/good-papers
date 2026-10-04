import type { Metadata } from "next";
import Link from "next/link";
import { AuthButton } from "@/components/AuthButton";
import { Icon, IconSprite } from "@/components/Icons";
import { SearchForm } from "@/components/SearchForm";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Rotten Paper: fresh or rotten?", template: "%s | Rotten Paper" },
  description: "Is this paper worth reading? Verdicts from readers, warm-started by an AI panel.",
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
              Rotten Paper
            </Link>
            <SearchForm />
            <AuthButton />
          </div>
        </header>
        {children}
        <footer className="foot wrap">
          Paper data from <a href="https://openalex.org">OpenAlex</a>. AI panel verdicts by Jev from each paper&apos;s
          abstract, with one-line takes written by a language model.
        </footer>
      </body>
    </html>
  );
}
