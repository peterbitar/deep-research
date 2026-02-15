/**
 * Fetch investor cards from the feed API (chat-from-scratch).
 * GET /api/feed?symbols=AAPL,MSFT,TSLA&mode=retail
 * Returns cards in FinanceCardResult format for compatibility.
 */

import type { FinanceCardResult } from './finance-card';

/** Default feed API URL when FEED_API_URL is not set. */
const DEFAULT_FEED_API_URL = 'https://chat-from-scratch-production.up.railway.app';

interface FeedCardRaw {
  symbol?: string;
  headline?: string;
  title?: string;
  content?: string;
  explanation?: string;
  whatItMeans?: string;
  riskNote?: string;
}

interface FeedResponse {
  success?: boolean;
  cards?: FeedCardRaw[];
  marketMood?: string;
}

/** Ensure bold mini-headlines have a space before the em dash: "**text**—" → "**text** — ". Exported for use in earnings card. */
export function normalizeCardContent(content: string): string {
  return content.replace(/\*\*([^*]+)\*\*—/g, '**$1** — ');
}

function toFinanceCard(card: FeedCardRaw): FinanceCardResult | null {
  const symbol = (card.symbol ?? '').trim().toUpperCase();
  const title = (card.title ?? card.headline ?? '').trim();
  let content = (card.content ?? '').trim();
  content = normalizeCardContent(content);
  if (!symbol || !title || !content) return null;
  return {
    title,
    content,
    emoji: '📰',
  };
}

/**
 * Fetch cards for symbols from the feed API.
 * Returns array of { symbol, card } for each symbol that got a card.
 */
export async function fetchCardsFromFeed(
  symbols: string[],
  options?: { mode?: string; baseUrl?: string }
): Promise<Array<{ symbol: string; card: FinanceCardResult }>> {
  const baseUrl = (
    options?.baseUrl ?? process.env.FEED_API_URL ?? DEFAULT_FEED_API_URL
  ).trim();
  if (!baseUrl) return [];

  const list = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (list.length === 0) return [];

  const mode = options?.mode ?? process.env.FEED_MODE ?? 'retail';
  const params = new URLSearchParams({ symbols: list.join(','), mode });
  const url = `${baseUrl.replace(/\/$/, '')}/api/feed?${params}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(90_000),
    });

    if (!res.ok) {
      console.warn(`[Feed Card] ${res.status} ${res.statusText}`);
      return [];
    }

    const data = (await res.json()) as FeedResponse;
    if (!data.success || !Array.isArray(data.cards)) return [];

    const out: Array<{ symbol: string; card: FinanceCardResult }> = [];
    for (const raw of data.cards) {
      const sym = (raw.symbol ?? '').trim().toUpperCase();
      const card = toFinanceCard(raw);
      if (sym && card) out.push({ symbol: sym, card });
    }
    return out;
  } catch (e) {
    console.warn('[Feed Card]', e instanceof Error ? e.message : e);
    return [];
  }
}

/** Base URL for earnings-recap (defaults to same as feed). */
function getEarningsRecapBaseUrl(): string {
  return (
    process.env.EARNINGS_RECAP_API_URL ??
    process.env.FEED_API_URL ??
    DEFAULT_FEED_API_URL
  ).trim();
}

/**
 * Fetch last reported quarter recap for a ticker.
 * GET /api/earnings-recap-feed/:ticker
 * Returns a short recap string or null.
 */
export async function fetchEarningsRecap(
  ticker: string,
  options?: { baseUrl?: string }
): Promise<string | null> {
  const baseUrl = (options?.baseUrl ?? getEarningsRecapBaseUrl()).trim();
  if (!baseUrl) return null;

  const sym = ticker.trim().toUpperCase();
  if (!sym) return null;

  const url = `${baseUrl.replace(/\/$/, '')}/api/earnings-recap-feed/${encodeURIComponent(sym)}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    if (typeof data?.recap === 'string') return data.recap.trim() || null;
    if (typeof data?.content === 'string') return data.content.trim() || null;
    if (typeof data?.summary === 'string') return data.summary.trim() || null;

    const r = data?.recap as Record<string, unknown> | undefined;
    if (r && typeof r === 'object') {
      const quarter = (r.quarter ?? r.reportedDate ?? '') as string;
      const reported = (r.reportedDate ?? r.reportDate ?? '') as string;
      const narrative = (r.narrativeSummary ?? '') as string;
      const rev = r.revenue as { actual?: number; estimate?: number; beatPct?: number } | undefined;
      const eps = r.eps as { actual?: number; estimate?: number; beatPct?: number } | undefined;
      const parts: string[] = [];
      if (quarter || reported)
        parts.push(`${[quarter, reported].filter(Boolean).join(' ')}`.trim());
      if (eps?.actual != null && eps?.estimate != null)
        parts.push(`EPS $${eps.actual} vs est $${eps.estimate}${eps.beatPct != null ? ` (${eps.beatPct > 0 ? '+' : ''}${eps.beatPct}%)` : ''}`);
      if (rev?.actual != null && rev?.estimate != null)
        parts.push(`Revenue $${(rev.actual / 1e9).toFixed(1)}B vs est $${(rev.estimate / 1e9).toFixed(1)}B${rev.beatPct != null ? ` (${rev.beatPct > 0 ? '+' : ''}${rev.beatPct}%)` : ''}`);
      if (narrative) parts.push(narrative);
      if (parts.length) return parts.join('. ');
    }
    return null;
  } catch {
    return null;
  }
}
