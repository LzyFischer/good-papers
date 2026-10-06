// Tagging for well-known organizations. Extend as you like.
const INDUSTRY = [
  "Google", "DeepMind", "Meta", "Microsoft", "OpenAI", "Anthropic", "NVIDIA", "Apple", "Amazon",
  "IBM", "Netflix", "AT&T", "Alibaba", "Tencent", "ByteDance", "Baidu", "Salesforce", "Adobe", "Huawei",
];
const TOP_SCHOOLS = [
  "Massachusetts Institute of Technology", "MIT", "Stanford", "Carnegie Mellon", "CMU",
  "University of California, Berkeley", "UC Berkeley", "Princeton", "Harvard", "University of Washington",
  "UW", "Tsinghua", "Peking University", "University of Oxford", "University of Cambridge", "ETH Zurich",
];

export function orgKind(org: string): "industry" | "top" | null {
  const o = org.toLowerCase();
  if (INDUSTRY.some((n) => o.includes(n.toLowerCase()))) return "industry";
  if (TOP_SCHOOLS.some((n) => o === n.toLowerCase() || o.includes(n.toLowerCase() + " ") || o.startsWith(n.toLowerCase())))
    return "top";
  return null;
}

// Short display names for long OpenAlex institution names.
export function shortOrg(org: string): string {
  return org
    .replace(/^University of /, "U ")
    .replace(/ University$/, "")
    .replace(/\s*\(.*\)$/, "")
    .slice(0, 32);
}

// "arXiv (Cornell University)" → "arXiv"; venues the worker detected already carry their year.
export function venueLabel(venue: string | null | undefined, year: number | null | undefined): string | null {
  if (!venue) return year ? String(year) : null;
  const v = /arxiv/i.test(venue) ? "arXiv" : venue;
  return /\b(19|20)\d{2}\b/.test(v) || !year ? v : `${v} ${year}`;
}
