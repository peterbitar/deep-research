/**
 * Parse publication/update date from the start of scraped markdown or from URL.
 * Scans the first N characters for common date patterns (no extra API, no LLM).
 */

const SCAN_LENGTH = 4000;

/** Patterns that capture a date-like substring; order matters (more specific first). */
const DATE_PATTERNS: Array<{ regex: RegExp; parse: (match: RegExpMatchArray) => Date | null }> = [
  // ISO: 2026-01-28 or 2026-01-28T12:00:00Z
  {
    regex: /\b(20\d{2})-(\d{2})-(\d{2})(?:T|\s|$)/,
    parse: (m) => new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])),
  },
  // "Published January 28, 2026" / "Updated Jan 28, 2026"
  {
    regex: /(?:published|updated|posted|date)\s*:?\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/i,
    parse: (m) => parseMonthDayYear(m[1], m[2], m[3]),
  },
  // "on January 28, 2026" / "as of Jan 28, 2026" / "reported January 28, 2026"
  {
    regex: /(?:on|as of|reported|—)\s*([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})/i,
    parse: (m) => parseMonthDayYear(m[1], m[2], m[3]),
  },
  // "January 28, 2026" / "Jan 28, 2026" at start or after common prefixes
  {
    regex: /\b([A-Za-z]+)\s+(\d{1,2}),?\s+(20\d{2})\b/,
    parse: (m) => parseMonthDayYear(m[1], m[2], m[3]),
  },
  // "28 January 2026"
  {
    regex: /\b(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})\b/,
    parse: (m) => parseMonthDayYear(m[2], m[1], m[3]),
  },
  // Q4 2025, Q2 2026 → end of quarter (last day of quarter)
  {
    regex: /\bQ([1-4])\s+(20\d{2})\b/i,
    parse: (m) => {
      const q = +m[1];
      const y = +m[2];
      const month = q * 3 - 1; // 0-indexed: Q1→2, Q2→5, Q3→8, Q4→11
      const lastDay = new Date(y, month + 1, 0).getDate();
      return new Date(y, month, lastDay);
    },
  },
  // DD/MM/YYYY or MM/DD/YYYY (prefer DD/MM when day > 12)
  {
    regex: /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/,
    parse: (m) => {
      const a = +m[1];
      const b = +m[2];
      const y = +m[3];
      if (a > 12) return new Date(y, b - 1, a);
      if (b > 12) return new Date(y, a - 1, b);
      return new Date(y, a - 1, b); // assume MM/DD
    },
  },
];

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7, sep: 8, sept: 8, september: 8,
  oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
};

function parseMonthDayYear(monthStr: string, dayStr: string, yearStr: string): Date | null {
  const month = MONTHS[monthStr.toLowerCase().slice(0, 3)];
  if (month === undefined) return null;
  const day = parseInt(dayStr, 10);
  const year = parseInt(yearStr, 10);
  if (day < 1 || day > 31 || year < 2000 || year > 2030) return null;
  const d = new Date(year, month, day);
  if (d.getMonth() !== month || d.getDate() !== day) return null;
  return d;
}

/**
 * Extract a publication or update date from the beginning of markdown.
 * Returns YYYY-MM-DD or null if no parseable date found.
 */
export function parseDateFromMarkdown(markdown: string): string | null {
  if (!markdown || typeof markdown !== 'string') return null;
  const head = markdown.slice(0, SCAN_LENGTH);

  for (const { regex, parse } of DATE_PATTERNS) {
    const match = head.match(regex);
    if (!match) continue;
    const d = parse(match);
    if (!d || isNaN(d.getTime())) continue;
    // Reject future or very old (likely typos)
    const now = new Date();
    if (d > now) continue;
    if (d.getFullYear() < 2000) continue;
    return d.toISOString().slice(0, 10);
  }

  return null;
}

/** URL patterns that contain a date (path or query). */
const URL_DATE_PATTERNS: Array<{ regex: RegExp; parse: (match: RegExpMatchArray) => Date | null }> = [
  // 2026-01-28 in path or query
  {
    regex: /(20\d{2})-(\d{2})-(\d{2})/,
    parse: (m) => new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])),
  },
  // /2026/01/28/ or /2026/01/28
  {
    regex: /\/(20\d{2})\/(\d{2})\/(\d{2})(?:\/|$)/,
    parse: (m) => new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])),
  },
  // 20260128 (compact)
  {
    regex: /(20\d{2})(\d{2})(\d{2})/,
    parse: (m) => new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])),
  },
];

/**
 * Extract a date from a URL (path or query) when present.
 * Returns YYYY-MM-DD or null.
 */
export function parseDateFromUrl(url: string): string | null {
  if (!url || typeof url !== 'string') return null;
  for (const { regex, parse } of URL_DATE_PATTERNS) {
    const match = url.match(regex);
    if (!match) continue;
    const d = parse(match);
    if (!d || isNaN(d.getTime())) continue;
    const now = new Date();
    if (d > now) continue;
    if (d.getFullYear() < 2000) continue;
    return d.toISOString().slice(0, 10);
  }
  return null;
}
