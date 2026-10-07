// The site's public address, for canonical links, the sitemap and share cards.
// Set NEXT_PUBLIC_SITE_URL in Vercel when the domain changes (e.g. https://goodpapers.org).
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://good-papers.vercel.app").replace(/\/$/, "");
