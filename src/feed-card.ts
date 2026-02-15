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

function toFinanceCard(card: FeedCardRaw): FinanceCardResult | null {
  const symbol = (card.symbol ?? '').trim().toUpperCase();
  const title = (card.title ?? card.headline ?? '').trim();
  const content = (card.content ?? '').trim();
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
