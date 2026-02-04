/**
 * Centralized Finnhub API calls for stocks
 * Fetches: quote, company news, basic financials, SEC filings, reported financials
 * Falls back to SEC EDGAR for filings when Finnhub is rate-limited
 */

import { fetchSECFilingsByTicker } from './free-financial-apis';

const FINNHUB_FETCH_TIMEOUT_MS = 15_000;
const BASE_URL = 'https://finnhub.io/api/v1';

// ============== Interfaces ==============

export interface FinnhubQuoteData {
  c?: number;      // current price
  d?: number;      // change (absolute)
  dp?: number;     // percent change
  h?: number;      // high
  l?: number;      // low
  o?: number;      // open
  pc?: number;     // previous close
  t?: number;      // timestamp
  error?: string;
}

export interface FinnhubCompanyNews {
  category: string;
  datetime: number;
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export interface FinnhubBasicFinancials {
  metric?: {
    '52WeekHigh'?: number;
    '52WeekLow'?: number;
    '10DayAverageTradingVolume'?: number;
    marketCapitalization?: number;
    peNormalizedAnnual?: number;
    ps?: number;
    pb?: number;
    eps?: number;
    beta?: number;
    dividendYieldIndicatedAnnual?: number;
    roe?: number;
    roa?: number;
    debt?: number;
    currentRatio?: number;
  };
  series?: {
    annual?: Record<string, Array<{ period: string; v: number }>>;
    quarterly?: Record<string, Array<{ period: string; v: number }>>;
  };
}

export interface FinnhubSECFiling {
  accessNumber: string;
  symbol: string;
  cik: string;
  form: string;        // '8-K', '10-Q', '10-K', etc.
  filedDate: string;
  acceptedDate: string;
  reportUrl: string;
  filingUrl: string;
}

export interface FinnhubFinancialsReported {
  symbol: string;
  cik: string;
  year: number;
  quarter: number;
  form: string;
  startDate: string;
  endDate: string;
  filedDate: string;
  acceptedDate: string;
  report: {
    bs?: Array<{      // Balance sheet
      label: string;
      concept: string;
      unit: string;
      value: number;
    }>;
    ic?: Array<{      // Income statement
      label: string;
      concept: string;
      unit: string;
      value: number;
    }>;
    cf?: Array<{      // Cash flow
      label: string;
      concept: string;
      unit: string;
      value: number;
    }>;
  };
}

export interface FinnhubCandle {
  c?: number[];  // close prices
  h?: number[];  // high prices
  l?: number[];  // low prices
  o?: number[];  // open prices
  v?: number[];  // volumes
  t?: number[];  // timestamps
  s?: string;    // status ('ok', 'no_data', etc.)
}

export interface EnrichedStockData {
  symbol: string;
  quote: FinnhubQuoteData | null;
  news: FinnhubCompanyNews[];
  metrics: FinnhubBasicFinancials | null;
  filings: FinnhubSECFiling[];
  financials: FinnhubFinancialsReported | null;
  candles: FinnhubCandle | null;
}

// ============== API Key Management ==============

function getFinnhubApiKey(): string | undefined {
  const raw = process.env.FINNHUB_KEY ?? process.env.FINNHUB_API_KEY;
  if (typeof raw !== 'string') return undefined;
  const key = raw.replace(/^["']|["']$/g, '').trim();
  return key || undefined;
}

// ============== Generic Fetch Helper ==============

async function fetchFinnhub<T>(
  endpoint: string,
  params: Record<string, string | number> = {}
): Promise<T | null> {
  const apiKey = getFinnhubApiKey();
  if (!apiKey) return null;

  const url = new URL(endpoint, BASE_URL);
  url.searchParams.append('token', apiKey);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.append(key, String(value));
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FINNHUB_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url.toString(), { signal: controller.signal });

    if (!response.ok) {
      const status = response.status;
      const statusText = response.statusText;
      if (status === 403 || status === 401) {
        console.warn(`Finnhub ${endpoint}: ${status} ${statusText} (auth error)`);
      } else if (status === 429) {
        console.warn(`Finnhub ${endpoint}: ${status} ${statusText} (rate limited)`);
      } else {
        console.warn(`Finnhub ${endpoint}: ${status} ${statusText}`);
      }
      return null;
    }

    const data = await response.json();
    return data as T;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort') || msg.includes('ETIMEDOUT')) {
      console.warn(`Finnhub ${endpoint}: timeout (${FINNHUB_FETCH_TIMEOUT_MS}ms)`);
    } else {
      console.warn(`Finnhub ${endpoint}: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============== API Endpoint Wrappers ==============

/**
 * Fetch current quote for a stock
 */
export async function fetchFinnhubQuote(symbol: string): Promise<FinnhubQuoteData | null> {
  if (!symbol) return null;
  return fetchFinnhub<FinnhubQuoteData>('/quote', { symbol });
}

/**
 * Fetch company news for a stock (past 7 days by default)
 */
export async function fetchFinnhubCompanyNews(
  symbol: string,
  from?: string,
  to?: string
): Promise<FinnhubCompanyNews[]> {
  if (!symbol) return [];

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const fromDate = from || sevenDaysAgo.toISOString().split('T')[0];
  const toDate = to || now.toISOString().split('T')[0];

  const result = await fetchFinnhub<{ data?: FinnhubCompanyNews[] }>('/company-news', {
    symbol,
    from: fromDate,
    to: toDate,
  });

  return result?.data ?? [];
}

/**
 * Fetch basic financials (metrics) for a stock
 */
export async function fetchFinnhubBasicFinancials(symbol: string): Promise<FinnhubBasicFinancials | null> {
  if (!symbol) return null;
  return fetchFinnhub<FinnhubBasicFinancials>('/stock/metric', {
    symbol,
    metric: 'all',
  });
}

/**
 * Fetch SEC filings for a stock (past 7 days by default)
 */
export async function fetchFinnhubFilings(
  symbol: string,
  from?: string,
  to?: string
): Promise<FinnhubSECFiling[]> {
  if (!symbol) return [];

  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const fromDate = from || sevenDaysAgo.toISOString().split('T')[0];
  const toDate = to || now.toISOString().split('T')[0];

  const result = await fetchFinnhub<{ filings?: FinnhubSECFiling[] }>('/stock/filings', {
    symbol,
    from: fromDate,
    to: toDate,
  });

  return result?.filings ?? [];
}

/**
 * Fetch reported financials (income statement, balance sheet, cash flow)
 * Returns most recent report (last quarter for quarterly, last year for annual)
 */
export async function fetchFinnhubFinancialsReported(symbol: string): Promise<FinnhubFinancialsReported | null> {
  if (!symbol) return null;
  return fetchFinnhub<FinnhubFinancialsReported>('/stock/financials-reported', { symbol });
}

/**
 * Fetch historical price candles for a stock
 * @param symbol Stock symbol
 * @param resolution 'D' for daily, 'W' for weekly, 'M' for monthly
 * @param from Unix timestamp
 * @param to Unix timestamp
 */
export async function fetchFinnhubCandle(
  symbol: string,
  resolution: string = 'D',
  from: number,
  to: number
): Promise<FinnhubCandle | null> {
  if (!symbol) return null;
  return fetchFinnhub<FinnhubCandle>('/stock/candle', {
    symbol,
    resolution,
    from,
    to,
  });
}

// ============== Composite Functions ==============

/**
 * Fetch all available Finnhub data for a stock in parallel
 * Falls back to SEC EDGAR for filings if Finnhub is rate-limited
 * Returns null values gracefully if endpoints fail
 */
export async function getAllFinnhubDataForStock(symbol: string): Promise<EnrichedStockData | null> {
  const apiKey = getFinnhubApiKey();
  if (!apiKey) return null;

  const normalizedSymbol = symbol.toUpperCase().trim();

  // Calculate Unix timestamps for past 7 days
  const now = Math.floor(Date.now() / 1000);
  const sevenDaysAgo = now - 7 * 24 * 60 * 60;

  // Fetch all endpoints in parallel
  const [quote, news, metrics, finnhubFilings, financials, candles] = await Promise.all([
    fetchFinnhubQuote(normalizedSymbol),
    fetchFinnhubCompanyNews(normalizedSymbol),
    fetchFinnhubBasicFinancials(normalizedSymbol),
    fetchFinnhubFilings(normalizedSymbol),
    fetchFinnhubFinancialsReported(normalizedSymbol),
    fetchFinnhubCandle(normalizedSymbol, 'D', sevenDaysAgo, now),
  ]);

  // If Finnhub filings failed (empty array), try SEC EDGAR as fallback
  let filings = finnhubFilings;
  if (filings.length === 0) {
    console.log(`Finnhub filings ${normalizedSymbol}: falling back to SEC EDGAR`);
    const secFilings = await fetchSECFilingsByTicker(normalizedSymbol, 5);
    // Convert SEC filings to Finnhub format
    filings = secFilings.map((f) => ({
      accessNumber: f.accessNumber,
      symbol: normalizedSymbol,
      cik: '',
      form: f.form,
      filedDate: f.filingDate,
      acceptedDate: f.acceptanceDateTime,
      reportUrl: `https://www.sec.gov/cgi-bin/viewer?action=view&cik=${f.accessNumber.replace(/-/g, '')}&accession_number=${f.accessNumber}&xbrl_type=v`,
      filingUrl: `https://www.sec.gov/Archives/${f.accessNumber.replace(/-/g, '')}/${f.primaryDocument}`,
    }));
  }

  return {
    symbol: normalizedSymbol,
    quote,
    news,
    metrics,
    filings,
    financials,
    candles,
  };
}
