/**
 * Financial Modeling Prep (FMP) API — quote and historical price.
 * Used as sole price source when FMP_API_KEY is set (no Finnhub/FreeCrypto/Yahoo).
 */

const FMP_BASE = 'https://financialmodelingprep.com';
const FMP_TIMEOUT_MS = 25_000;

export function getFmpApiKey(): string | undefined {
  const raw = process.env.FMP_API_KEY ?? process.env.FMP_KEY;
  if (typeof raw !== 'string') return undefined;
  const key = raw.replace(/^["']|["']$/g, '').trim();
  return key || undefined;
}

export interface FmpQuote {
  symbol?: string;
  name?: string;
  price?: number;
  changesPercentage?: number;
  change?: number;
  previousClose?: number;
  dayLow?: number;
  dayHigh?: number;
  yearHigh?: number;
  yearLow?: number;
  marketCap?: number;
  priceAvg50?: number;
  priceAvg200?: number;
  volume?: number;
  open?: number;
  timestamp?: number;
  pe?: number;
  eps?: number;
  beta?: number;
  dividend?: number;
}

/** GET /api/v3/quote/:symbol */
export async function fetchFmpQuote(symbol: string): Promise<FmpQuote | null> {
  const key = getFmpApiKey();
  if (!key) return null;

  const url = `${FMP_BASE}/api/v3/quote/${encodeURIComponent(symbol.toUpperCase())}?apikey=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FMP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const data = (await res.json()) as FmpQuote[];
    const first = Array.isArray(data) ? data[0] : null;
    return first && typeof first.price === 'number' ? first : null;
  } catch {
    clearTimeout(t);
    return null;
  }
}

export interface FmpHistoricalDay {
  date: string;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
}

/** GET /api/v3/historical-price-full/:symbol?from=...&to=... */
export async function fetchFmpHistorical(
  symbol: string,
  from: string,
  to: string
): Promise<FmpHistoricalDay[]> {
  const key = getFmpApiKey();
  if (!key) return [];

  const url = `${FMP_BASE}/api/v3/historical-price-full/${encodeURIComponent(symbol.toUpperCase())}?from=${from}&to=${to}&apikey=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FMP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = (await res.json()) as { historical?: Array<{ date: string; close: number; open?: number; high?: number; low?: number; volume?: number }> };
    const hist = data?.historical;
    if (!Array.isArray(hist)) return [];
    return hist
      .filter((d) => typeof d.close === 'number')
      .map((d) => ({ date: d.date, close: d.close, open: d.open, high: d.high, low: d.low, volume: d.volume }));
  } catch {
    clearTimeout(t);
    return [];
  }
}

/**
 * Fetch batch quotes for multiple symbols in one request.
 * GET /api/v3/quote/AAPL,MSFT,NVDA
 */
export async function fetchFmpBatchQuote(symbols: string[]): Promise<Map<string, FmpQuote>> {
  const key = getFmpApiKey();
  if (!key || symbols.length === 0) return new Map();

  const list = symbols.map((s) => s.toUpperCase().trim()).filter(Boolean);
  const uniq = [...new Set(list)];
  const url = `${FMP_BASE}/api/v3/quote/${uniq.join(',')}?apikey=${encodeURIComponent(key)}`;

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), FMP_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(t);
    if (!res.ok) return new Map();
    const data = (await res.json()) as FmpQuote[];
    const map = new Map<string, FmpQuote>();
    if (Array.isArray(data)) {
      for (const q of data) {
        if (q?.symbol && typeof q.price === 'number') map.set(q.symbol.toUpperCase(), q);
      }
    }
    return map;
  } catch {
    clearTimeout(t);
    return new Map();
  }
}
