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

// Venues the worker recognizes (worker/extras.py VENUES). It always writes the year when it
// knows it, so a bare "ICLR" means the year is unknown: the preprint's year is often not the
// conference's, so it isn't added.
const SHORT_VENUES = new Set([
  "NeurIPS", "ICML", "ICLR", "CVPR", "ICCV", "ECCV", "NAACL", "EACL", "EMNLP", "COLING", "COLM", "ACL", "AAAI",
  "IJCAI", "KDD", "WWW", "SIGIR", "CIKM", "WSDM", "AISTATS", "UAI", "CoRL", "ICRA", "IROS", "RSS", "MICCAI",
  "ISBI", "ICASSP", "Interspeech", "TMLR", "JMLR", "TPAMI", "LoG",
]);

// "arXiv (Cornell University)" → "arXiv"; venues the worker detected already carry their year.
export function venueLabel(venue: string | null | undefined, year: number | null | undefined): string | null {
  if (!venue) return year ? String(year) : null;
  const v = /arxiv/i.test(venue) ? "arXiv" : venue;
  return /\b(19|20)\d{2}\b/.test(v) || !year || SHORT_VENUES.has(v) ? v : `${v} ${year}`;
}
