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
  eventType?: string;
  event_type?: string;
  explanation?: { classification?: { eventType?: string } };
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

/** Extract eventType from client shape: explanation.classification.eventType, or top-level eventType/event_type. */
function eventTypeFromCard(obj: Record<string, unknown> | undefined): string | undefined {
  if (!obj) return undefined;
  const expl = obj.explanation as Record<string, unknown> | undefined;
  const classification = expl?.classification as Record<string, unknown> | undefined;
  const v = (classification?.eventType ?? obj.eventType ?? obj.event_type) as string | undefined;
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}

function toFinanceCard(card: FeedCardRaw): FinanceCardResult | null {
  const symbol = (card.symbol ?? '').trim().toUpperCase();
  const title = (card.title ?? card.headline ?? '').trim();
  let content = (card.content ?? '').trim();
  content = normalizeCardContent(content);
  if (!symbol || !title || !content) return null;
  const eventType = eventTypeFromCard(card as unknown as Record<string, unknown>);
  return {
    title,
    content,
    emoji: '📰',
    ...(eventType && { eventType }),
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

export interface EarningsRecapResult {
  recap: string;
  eventType?: string;
}

/**
 * Fetch last reported quarter recap for a ticker.
 * GET /api/earnings-recap-feed/:ticker
 * Returns { recap, eventType? } or null.
 */
export async function fetchEarningsRecap(
  ticker: string,
  options?: { baseUrl?: string }
): Promise<EarningsRecapResult | null> {
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
    const topEventType = eventTypeFromCard(data);

    // Feed-style response: { success, cards: [{ symbol, title, content, explanation? }] }
    const cards = data?.cards as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(cards) && cards.length > 0) {
      const first = cards[0];
      const content = typeof first?.content === 'string' ? first.content.trim() : '';
      if (content) {
        const eventType = eventTypeFromCard(first) ?? topEventType;
        return { recap: content, ...(eventType && { eventType }) };
      }
    }
    if (typeof data?.recap === 'string') {
      const recap = data.recap.trim();
      if (recap) return { recap, ...(topEventType && { eventType: topEventType }) };
    }
    if (typeof data?.content === 'string') {
      const content = data.content.trim();
      if (content) return { recap: content, ...(topEventType && { eventType: topEventType }) };
    }
    if (typeof data?.summary === 'string') {
      const summary = data.summary.trim();
      if (summary) return { recap: summary, ...(topEventType && { eventType: topEventType }) };
    }

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
      if (parts.length) {
        const eventType = eventTypeFromCard(r) ?? topEventType;
        return { recap: parts.join('. '), ...(eventType && { eventType }) };
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Base URL for news-feed (defaults to same as feed). */
function getNewsFeedBaseUrl(): string {
  return (
    process.env.NEWS_FEED_API_URL ??
    process.env.FEED_API_URL ??
    DEFAULT_FEED_API_URL
  ).trim();
}

/**
 * Fetch news-feed card for a ticker.
 * GET /api/news-feed/:ticker
 * Returns a card for the holding or null.
 */
export async function fetchNewsFeedCard(
  ticker: string,
  options?: { baseUrl?: string }
): Promise<FinanceCardResult | null> {
  const baseUrl = (options?.baseUrl ?? getNewsFeedBaseUrl()).trim();
  if (!baseUrl) return null;

  const sym = ticker.trim().toUpperCase();
  if (!sym) return null;

  const url = `${baseUrl.replace(/\/$/, '')}/api/news-feed/${encodeURIComponent(sym)}`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(20_000),
    });

    if (!res.ok) return null;

    const data = (await res.json()) as Record<string, unknown>;
    // Feed-style: { success, cards: [{ symbol, title, content, explanation? }] }
    const cards = data?.cards as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(cards) && cards.length > 0) {
      const first = cards[0];
      const title = (typeof first?.title === 'string' ? first.title : '').trim();
      let content = (typeof first?.content === 'string' ? first.content : '').trim();
      content = normalizeCardContent(content);
      if (title || content) {
        const eventType = eventTypeFromCard(first);
        return {
          title: title || `${sym} — News`,
          content: content || 'No content.',
          emoji: '📰',
          ...(eventType && { eventType }),
        };
      }
    }
    // Single card: { title, content } or { card: { title, content } }
    const card = (data?.card ?? data) as Record<string, unknown> | undefined;
    if (card && typeof card === 'object') {
      const title = (typeof card.title === 'string' ? card.title : '').trim();
      let content = (typeof card.content === 'string' ? card.content : '').trim();
      content = normalizeCardContent(content);
      if (title || content) {
        const eventType = eventTypeFromCard(card);
        return {
          title: title || `${sym} — News`,
          content: content || 'No content.',
          emoji: '📰',
          ...(eventType && { eventType }),
        };
      }
    }
    // Plain text (top-level or explanation.classification.eventType)
    const topEventType = eventTypeFromCard(data);
    if (typeof data?.content === 'string') {
      const content = normalizeCardContent(data.content.trim());
      if (content) {
        return { title: `${sym} — News`, content, emoji: '📰', ...(topEventType && { eventType: topEventType }) };
      }
    }
    if (typeof data?.summary === 'string') {
      const content = normalizeCardContent(data.summary.trim());
      if (content) {
        return { title: `${sym} — News`, content, emoji: '📰', ...(topEventType && { eventType: topEventType }) };
      }
    }
    return null;
  } catch {
    return null;
  }
}
