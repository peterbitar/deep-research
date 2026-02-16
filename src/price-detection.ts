// Price move detection for trigger system
// Stocks: Finnhub (when FINNHUB_KEY set) else Yahoo. Crypto: FreeCryptoAPI (when FREECRYPTOAPI_KEY set) else Yahoo.

import {
  getAllFinnhubDataForStock,
  fetchFinnhubQuote,
  fetchFinnhubCandle,
} from './finnhub-data';
import {
  fetchAlphaVantageQuote,
  fetchAlphaVantageTimeSeries,
} from './free-financial-apis';

const CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'XRP']);

/** ETFs that Yahoo handles well; try Yahoo first to avoid Finnhub rate limits. */
const PREFER_YAHOO_ETFS = new Set([
  'GLD', 'SLV', 'IAU', 'SPY', 'QQQ', 'VOO', 'IWM', 'TLT', 'GLDM', 'SPXL',
]);

export type PriceData = {
  symbol: string;
  currentPrice: number;
  price7DaysAgo: number;
  changePercent: number;
  changeAbsolute: number;
  /** Previous session close; present when we have at least 2 days. */
  price1DayAgo?: number;
  /** 1-day % change (current vs previous close). */
  changePercent1d?: number;

  // NEW: Additional financial data from Finnhub
  marketCap?: number;
  peRatio?: number;
  eps?: number;
  beta?: number;
  dividendYield?: number;
  weekHigh52?: number;
  weekLow52?: number;
  avgVolume10d?: number;

  // NEW: Recent events
  recentNews?: Array<{
    headline: string;
    summary: string;
    datetime: number;
    source: string;
    url: string;
  }>;

  recentFilings?: Array<{
    form: string;
    filedDate: string;
    reportUrl: string;
  }>;

  latestEarnings?: {
    period: string;
    filedDate: string;
    revenue?: number;
    netIncome?: number;
    eps?: number;
  };
};

/**
 * Map our symbol to Yahoo Finance symbol.
 * Crypto uses -USD suffix; commodities/forex use Yahoo conventions.
 */
export function getYahooSymbol(symbol: string): string {
  const s = symbol.toUpperCase().trim();
  const mapping: Record<string, string> = {
    // Crypto
    BTC: 'BTC-USD',
    ETH: 'ETH-USD',
    SOL: 'SOL-USD',
    DOGE: 'DOGE-USD',
    XRP: 'XRP-USD',
    // Forex / dollar index
    DXY: 'DX-Y.NYB',
    USDJPY: 'USDJPY=X',
    'USD/JPY': 'USDJPY=X',
    EURUSD: 'EURUSD=X',
    'EUR/USD': 'EURUSD=X',
    GBPUSD: 'GBPUSD=X',
    'GBP/USD': 'GBPUSD=X',
    // Commodities
    GOLD: 'GC=F',
    XAU: 'GC=F',
    SILVER: 'SI=F',
    XAG: 'SI=F',
    OIL: 'CL=F',
    CRUDE: 'CL=F',
    WTI: 'CL=F',
    BRENT: 'BZ=F',
    NG: 'NG=F',
    NATGAS: 'NG=F',
    // Indices
    SPX: '^GSPC',
    'S&P500': '^GSPC',
    SP500: '^GSPC',
    NDX: '^NDX',
    DJI: '^DJI',
  };
  return mapping[s] ?? s;
}

const YAHOO_FETCH_TIMEOUT_MS = 50_000; // 50s for slow egress / datacenter (e.g. Railway)

/**
 * Fetch enriched stock price data from Finnhub (quote + news + metrics + filings + candles)
 */
export async function fetchEnrichedPriceFromFinnhub(symbol: string): Promise<PriceData | null> {
  const finnhubData = await getAllFinnhubDataForStock(symbol);
  if (!finnhubData || !finnhubData.quote) return null;

  const quote = finnhubData.quote;
  if (typeof quote.c !== 'number' || quote.c === 0) {
    console.warn(`Finnhub enriched ${symbol}: invalid price data`);
    return null;
  }

  let currentPrice = quote.c;
  let price7DaysAgo = quote.pc ?? currentPrice;
  let changePercent = 0;
  let changeAbsolute = quote.d ?? 0;

  // Use candles for accurate 7-day data if available
  if (finnhubData.candles && finnhubData.candles.s === 'ok' && finnhubData.candles.c && finnhubData.candles.c.length >= 2) {
    const closes = finnhubData.candles.c;
    price7DaysAgo = closes[0];
    currentPrice = closes[closes.length - 1];
    changeAbsolute = currentPrice - price7DaysAgo;
    changePercent = (changeAbsolute / price7DaysAgo) * 100;
  } else {
    // Fallback: use quote data if candles not available
    const previousClose = quote.pc ?? currentPrice;
    price7DaysAgo = previousClose;
    changeAbsolute = quote.d ?? (currentPrice - previousClose);
    changePercent = quote.dp ?? 0;
  }

  const previousClose = quote.pc ?? currentPrice;
  const changePercent1d = quote.dp ?? (previousClose !== 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);

  // Extract metrics (P/E and others are company-level only; no industry/sector here)
  const metrics = finnhubData.metrics?.metric ?? {};
  // Finnhub marketCap unit is ambiguous: if value >= 1e9 assume dollars; else assume millions
  const rawMc = metrics.marketCapitalization;
  const marketCap =
    rawMc == null
      ? undefined
      : rawMc >= 1e9
        ? rawMc
        : rawMc * 1_000_000;
  const peRatio = metrics.peNormalizedAnnual ?? undefined;
  const eps = metrics.eps ?? undefined;
  const beta = metrics.beta ?? undefined;
  const dividendYield = metrics.dividendYieldIndicatedAnnual ?? undefined;
  const weekHigh52 = metrics['52WeekHigh'] ?? undefined;
  const weekLow52 = metrics['52WeekLow'] ?? undefined;
  const avgVolume10d = metrics['10DayAverageTradingVolume'] ?? undefined;

  // Extract recent news (max 3 items, from past 7 days)
  const recentNews =
    finnhubData.news && finnhubData.news.length > 0
      ? finnhubData.news.slice(0, 3).map((n) => ({
          headline: n.headline,
          summary: n.summary,
          datetime: n.datetime,
          source: n.source,
          url: n.url,
        }))
      : undefined;

  // Extract recent SEC filings (max 3 items)
  const recentFilings =
    finnhubData.filings && finnhubData.filings.length > 0
      ? finnhubData.filings.slice(0, 3).map((f) => ({
          form: f.form,
          filedDate: f.filedDate,
          reportUrl: f.reportUrl,
        }))
      : undefined;

  // Extract latest earnings from reported financials
  let latestEarnings = undefined;
  if (finnhubData.financials) {
    const f = finnhubData.financials;
    const period = f.quarter ? `Q${f.quarter} ${f.year}` : `${f.year}`;

    // Try to extract revenue and net income from income statement
    let revenue: number | undefined;
    let netIncome: number | undefined;

    if (f.report.ic && f.report.ic.length > 0) {
      const ic = f.report.ic;
      const revenueItem = ic.find((item) => item.label?.toLowerCase().includes('revenue') || item.concept?.toLowerCase().includes('revenue'));
      const netIncomeItem = ic.find((item) => item.label?.toLowerCase().includes('net income') || item.concept?.toLowerCase().includes('net income'));

      if (revenueItem) revenue = revenueItem.value;
      if (netIncomeItem) netIncome = netIncomeItem.value;
    }

    latestEarnings = {
      period,
      filedDate: f.filedDate,
      revenue,
      netIncome,
      eps,
    };
  }

  console.log(`Finnhub enriched ${symbol}: $${currentPrice.toFixed(2)}, 7d: ${changePercent.toFixed(1)}%, 1d: ${changePercent1d.toFixed(1)}%`);

  return {
    symbol,
    currentPrice,
    price7DaysAgo,
    changePercent,
    changeAbsolute,
    price1DayAgo: previousClose,
    changePercent1d,
    marketCap,
    peRatio,
    eps,
    beta,
    dividendYield,
    weekHigh52,
    weekLow52,
    avgVolume10d,
    recentNews,
    recentFilings,
    latestEarnings,
  };
}

/**
 * Fetch US stock price from Finnhub (quote only - simple fallback)
 * Used when enriched data is not needed
 */
async function fetchPriceFromFinnhub(symbol: string): Promise<PriceData | null> {
  const quote = await fetchFinnhubQuote(symbol);
  if (!quote) return null;

  if (typeof quote.c !== 'number' || quote.c === 0) {
    console.warn(`Finnhub quote ${symbol}: invalid data`);
    return null;
  }

  const currentPrice = quote.c;
  const previousClose = quote.pc ?? currentPrice;
  const price7DaysAgo = previousClose;
  const changeAbsolute = quote.d ?? (currentPrice - previousClose);
  const changePercent = quote.dp ?? 0;
  const changePercent1d = quote.dp ?? (previousClose !== 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);

  console.log(`Finnhub quote ${symbol}: $${currentPrice.toFixed(2)}, 1d: ${changePercent1d?.toFixed(2)}%`);

  return {
    symbol,
    currentPrice,
    price7DaysAgo,
    changePercent,
    changeAbsolute,
    price1DayAgo: previousClose,
    changePercent1d,
  };
}

/**
 * Fetch stock price from Alpha Vantage (free, better than Yahoo)
 * Uses time series data for accurate 7-day pricing
 */
async function fetchPriceFromAlphaVantage(symbol: string): Promise<PriceData | null> {
  const timeSeries = await fetchAlphaVantageTimeSeries(symbol);
  if (!timeSeries || !timeSeries['Time Series (Daily)']) return null;

  const series = timeSeries['Time Series (Daily)'];
  const dates = Object.keys(series).sort().reverse(); // Most recent first

  if (dates.length < 2) {
    console.warn(`Alpha Vantage ${symbol}: insufficient historical data`);
    return null;
  }

  // Get most recent close
  const currentDate = dates[0];
  const currentPrice = parseFloat(series[currentDate]['4. close']);

  // Get 7 days ago (or closest business day)
  let price7DaysAgo = currentPrice;
  let sevenDayIndex = Math.min(7, dates.length - 1);
  if (sevenDayIndex > 0) {
    price7DaysAgo = parseFloat(series[dates[sevenDayIndex]]['4. close']);
  }

  // Get previous close (1 day ago)
  const previousDate = dates[1];
  const price1DayAgo = previousDate ? parseFloat(series[previousDate]['4. close']) : currentPrice;

  if (!Number.isFinite(currentPrice) || !Number.isFinite(price7DaysAgo)) {
    console.warn(`Alpha Vantage ${symbol}: non-finite prices`);
    return null;
  }

  const changeAbsolute = currentPrice - price7DaysAgo;
  const changePercent = (changeAbsolute / price7DaysAgo) * 100;
  const changePercent1d = price1DayAgo ? ((currentPrice - price1DayAgo) / price1DayAgo) * 100 : 0;

  console.log(`Alpha Vantage ${symbol}: $${currentPrice.toFixed(2)}, 7d: ${changePercent.toFixed(1)}%, 1d: ${changePercent1d.toFixed(1)}%`);

  return {
    symbol,
    currentPrice,
    price7DaysAgo,
    changePercent,
    changeAbsolute,
    price1DayAgo,
    changePercent1d,
  };
}

const FREECRYPTOAPI_FETCH_TIMEOUT_MS = 30_000; // Increased for network latency

function getFreeCryptoApiKey(): string | undefined {
  const raw =
    process.env.FREECRYPTOAPI_KEY ??
    process.env.FREECRYPTOAPI_TOKEN ??
    process.env.FREECRYPTOAPI_API_KEY;
  if (typeof raw !== 'string') return undefined;
  const key = raw.replace(/^["']|["']$/g, '').trim();
  return key || undefined;
}

/**
 * Fetch crypto price from FreeCryptoAPI. Used when FREECRYPTOAPI_KEY is set.
 * Returns current price and 24h change; 7d is set to current (no 7d from API).
 */
async function fetchPriceFromFreeCryptoAPI(symbol: string): Promise<PriceData | null> {
  const apiKey = getFreeCryptoApiKey();
  if (!apiKey) return null;

  const url = `https://api.freecryptoapi.com/v1/getData?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FREECRYPTOAPI_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    console.warn(`FreeCryptoAPI fetch ${symbol}: ${response.status} ${response.statusText}`);
    return null;
  }

  const data = (await response.json()) as {
    symbol?: string;
    price?: number;
    change_24h?: number;
    data?: Array<{ symbol?: string; price?: number; change_24h?: number }>;
  };

  // API may return single object or { data: [...] }
  const item = data.data?.[0] ?? data;
  const price = typeof item?.price === 'number' ? item.price : null;
  if (price == null || price <= 0) return null;

  const change24h = typeof item?.change_24h === 'number' ? item.change_24h : 0;
  const price1DayAgo = change24h !== 0 ? price / (1 + change24h / 100) : price;

  return {
    symbol: (item?.symbol ?? symbol).toUpperCase(),
    currentPrice: price,
    price7DaysAgo: price, // API doesn't provide 7d; use current so 0% 7d
    changePercent: 0,
    changeAbsolute: 0,
    price1DayAgo,
    changePercent1d: change24h,
  };
}

function isRetryableError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && 'cause' != null ? String((error as { cause?: unknown }).cause) : '';
  return (
    msg.includes('abort') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('fetch failed') ||
    cause.includes('ETIMEDOUT')
  );
}

/** Browser-like headers so Yahoo Finance is less likely to block server/datacenter requests. */
const YAHOO_FETCH_HEADERS: HeadersInit = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
};

/**
 * Single attempt to fetch price for a symbol (used internally with optional retry).
 */
async function fetchPriceOnce(symbol: string): Promise<PriceData | null> {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=7d`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), YAHOO_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: YAHOO_FETCH_HEADERS,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    console.warn(
      `Yahoo price fetch ${symbol}: ${response.status} ${response.statusText}` +
        (response.status === 403 ? ' (blocked — try FINNHUB_KEY for stocks, FREECRYPTOAPI_KEY for crypto)' : '') +
        (response.status === 429 ? ' (rate limited — reduce concurrency or use API keys)' : '')
    );
    return null;
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch (e) {
    console.warn(`Yahoo price fetch ${symbol}: invalid JSON`, e instanceof Error ? e.message : e);
    return null;
  }
  interface YahooChartResult {
    timestamp?: unknown;
    indicators?: { quote?: Array<{ close?: (number | null)[] }> };
  }
  const result = (data as { chart?: { result?: YahooChartResult[] } })?.chart?.result?.[0];

  if (!result?.timestamp || !result.indicators?.quote?.[0]) {
    console.warn(`Yahoo price fetch ${symbol}: invalid or changed response format`);
    return null;
  }

  const quotes = result.indicators.quote[0];
  const closes = quotes.close ?? [];

  const validPrices = closes.filter((p: number | null) => p !== null && p !== undefined);
  if (validPrices.length < 2) {
    console.warn(`Yahoo price fetch ${symbol}: insufficient data (need at least 2 close prices)`);
    return null;
  }

  const price7DaysAgo = validPrices[0];
  const currentPrice = validPrices[validPrices.length - 1];
  const changeAbsolute = currentPrice - price7DaysAgo;
  const changePercent = (changeAbsolute / price7DaysAgo) * 100;

  const price1DayAgo =
    validPrices.length >= 2 ? validPrices[validPrices.length - 2] : undefined;
  const changePercent1d =
    price1DayAgo != null && price1DayAgo !== 0
      ? ((currentPrice - price1DayAgo) / price1DayAgo) * 100
      : undefined;

  return {
    symbol,
    currentPrice,
    price7DaysAgo,
    changePercent,
    changeAbsolute,
    ...(price1DayAgo != null && { price1DayAgo }),
    ...(changePercent1d != null && { changePercent1d }),
  };
}

/**
 * Get price data for a holding using Yahoo Finance API.
 * Retries once on timeout/network; 50s timeout per attempt for containers/proxies.
 */
export async function getPriceData(symbol: string): Promise<PriceData | null> {
  try {
    return await fetchPriceOnce(symbol);
  } catch (error) {
    if (isRetryableError(error)) {
      await new Promise((r) => setTimeout(r, 2_000)); // 2s backoff before retry
      try {
        return await fetchPriceOnce(symbol);
      } catch (retryError) {
        console.warn(`Price fetch ${symbol}: timeout or network (after retry)`);
        return null;
      }
    }
    const msg = error instanceof Error ? error.message : String(error);
    console.warn(`Price fetch ${symbol}:`, msg);
    return null;
  }
}

/**
 * Get price data for multiple holdings
 */
export async function getPriceDataBatch(
  symbols: string[]
): Promise<Map<string, PriceData>> {
  const priceMap = new Map<string, PriceData>();
  
  // Fetch in parallel (with rate limiting if needed)
  const pricePromises = symbols.map(async symbol => {
    const priceData = await getPriceData(symbol);
    if (priceData) {
      priceMap.set(symbol, priceData);
    }
    return priceData;
  });
  
  await Promise.all(pricePromises);
  return priceMap;
}

/**
 * True when the symbol is a US-style ticker (no Yahoo mapping), so Finnhub quote API applies.
 */
function isUnmappedUsTicker(yahooSymbol: string, normalized: string): boolean {
  return yahooSymbol === normalized;
}

/**
 * Get price data for one holding (maps symbol to Yahoo symbol, e.g. BTC -> BTC-USD).
 * Crypto: FreeCryptoAPI → Yahoo.
 * Stocks/ETFs: Finnhub enriched → Alpha Vantage → Yahoo.
 * Returns PriceData keyed by the original symbol.
 */
export async function getPriceDataForHolding(
  ourSymbol: string
): Promise<PriceData | null> {
  const normalized = ourSymbol.toUpperCase().trim();
  const yahooSymbol = getYahooSymbol(ourSymbol);

  // Crypto: try FreeCryptoAPI first when key is set
  if (CRYPTO_SYMBOLS.has(normalized) && getFreeCryptoApiKey()) {
    const cryptoData = await fetchPriceFromFreeCryptoAPI(normalized);
    if (cryptoData) return cryptoData;
  }

  // For well-known ETFs, try Yahoo first to avoid Finnhub rate limits (429)
  if (PREFER_YAHOO_ETFS.has(normalized)) {
    const yahooData = await getPriceData(yahooSymbol);
    if (yahooData) return { ...yahooData, symbol: normalized };
  }

  // For other stocks/ETFs, try Finnhub enriched first (primary for US tickers)
  if (isUnmappedUsTicker(yahooSymbol, normalized)) {
    const enrichedData = await fetchEnrichedPriceFromFinnhub(normalized);
    if (enrichedData) return enrichedData;

    const alphaVantageData = await fetchPriceFromAlphaVantage(normalized);
    if (alphaVantageData) return alphaVantageData;
  }

  // Final fallback to Yahoo Finance
  const data = await getPriceData(yahooSymbol);
  if (data) return { ...data, symbol: normalized };

  return null;
}

const BATCH_CONCURRENCY = 3; // Limit parallel Yahoo fetches to avoid connection limits in containers

/**
 * Get price data for all holdings; returns Map keyed by original symbol (e.g. NVDA, BTC).
 * Fetches in small batches to avoid ETIMEDOUT in production (e.g. Railway).
 * Logs which symbols succeeded and which failed when not all succeed.
 */
export async function getPriceDataBatchForHoldings(holdings: {
  symbol: string;
}[]): Promise<Map<string, PriceData>> {
  const symbols = [...new Set(holdings.map((h) => h.symbol.toUpperCase()))];
  const map = new Map<string, PriceData>();
  for (let i = 0; i < symbols.length; i += BATCH_CONCURRENCY) {
    const chunk = symbols.slice(i, i + BATCH_CONCURRENCY);
    const results = await Promise.all(chunk.map((sym) => getPriceDataForHolding(sym)));
    for (const data of results) {
      if (data) map.set(data.symbol, data);
    }
  }
  const succeeded = symbols.filter((s) => map.has(s));
  const failed = symbols.filter((s) => !map.has(s));
  if (succeeded.length > 0) {
    console.log(`Price fetch: ${succeeded.length}/${symbols.length} symbols (${succeeded.join(', ')})`);
  }
  if (failed.length > 0) {
    console.warn(`Price fetch failed for: ${failed.join(', ')}. Check logs above for 403/429/timeout.`);
  }
  return map;
}

/**
 * Check if price move is significant (>5% change)
 */
export function isSignificantPriceMove(priceData: PriceData): boolean {
  return Math.abs(priceData.changePercent) > 5;
}
