// The site's public address, for canonical links, the sitemap and share cards (server side
// only). Set SITE_URL in Vercel when the domain changes (e.g. https://www.goodpapers.org).
export const SITE_URL = (process.env.SITE_URL ?? "https://good-papers.vercel.app").replace(/\/$/, "");
