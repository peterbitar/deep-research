// Price move detection for trigger system
// Stocks: Finnhub (when FINNHUB_KEY set) else Yahoo. Crypto: FreeCryptoAPI (when FREECRYPTOAPI_KEY set) else Yahoo.

const CRYPTO_SYMBOLS = new Set(['BTC', 'ETH', 'SOL', 'DOGE', 'XRP']);

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

const YAHOO_FETCH_TIMEOUT_MS = 25_000; // 25s for slow egress / datacenter (e.g. Railway)

const FINNHUB_FETCH_TIMEOUT_MS = 15_000;

function getFinnhubApiKey(): string | undefined {
  const raw = process.env.FINNHUB_KEY ?? process.env.FINNHUB_API_KEY;
  if (typeof raw !== 'string') return undefined;
  const key = raw.replace(/^["']|["']$/g, '').trim();
  return key || undefined;
}

/**
 * Fetch US stock price from Finnhub (official API). Used when FINNHUB_KEY is set.
 * Uses the /quote endpoint (free tier) instead of /candle (paid).
 * Returns current price and 1-day change; 7-day change is set to 0 (not available on free tier).
 */
async function fetchPriceFromFinnhub(symbol: string): Promise<PriceData | null> {
  const apiKey = getFinnhubApiKey();
  if (!apiKey) return null;

  const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FINNHUB_FETCH_TIMEOUT_MS);
  let response: Response;
  try {
    response = await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!response.ok) {
    console.warn(`Finnhub fetch ${symbol}: ${response.status} ${response.statusText}`);
    return null;
  }

  const data = (await response.json()) as {
    c?: number; // current price
    d?: number; // change (absolute)
    dp?: number; // change percent
    h?: number; // high
    l?: number; // low
    o?: number; // open
    pc?: number; // previous close
    t?: number; // timestamp
    error?: string;
  };

  // Check for error or missing data
  if (data.error || typeof data.c !== 'number' || data.c === 0) {
    console.warn(`Finnhub quote ${symbol}: invalid data`, data.error || 'no price');
    return null;
  }

  const currentPrice = data.c;
  const previousClose = data.pc ?? currentPrice;
  // Quote endpoint doesn't have 7-day data; use previous close as approximation
  const price7DaysAgo = previousClose;
  const changeAbsolute = data.d ?? (currentPrice - previousClose);
  // For 7-day change, we don't have data so set to 0 (or use 1-day as fallback)
  const changePercent = 0; // No 7-day data on free tier
  const changePercent1d = data.dp ?? (previousClose !== 0 ? ((currentPrice - previousClose) / previousClose) * 100 : 0);

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

const FREECRYPTOAPI_FETCH_TIMEOUT_MS = 15_000;

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
  const response = await fetch(url, {
    signal: controller.signal,
    headers: YAHOO_FETCH_HEADERS,
  });
  clearTimeout(timeoutId);
  if (!response.ok) {
    console.warn(`Failed to fetch price data for ${symbol}: ${response.statusText}`);
    return null;
  }

  const data = await response.json();
  const result = data.chart?.result?.[0];

  if (!result || !result.timestamp || !result.indicators?.quote?.[0]) {
    console.warn(`Invalid price data format for ${symbol}`);
    return null;
  }

  const quotes = result.indicators.quote[0];
  const closes = quotes.close;

  const validPrices = closes.filter((p: number | null) => p !== null && p !== undefined);
  if (validPrices.length < 2) {
    console.warn(`Insufficient price data for ${symbol}`);
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
 * Retries once on timeout/network; 20s timeout per attempt for containers/proxies.
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
 * Get price data for one holding (maps symbol to Yahoo symbol, e.g. BTC -> BTC-USD).
 * Crypto: FreeCryptoAPI when FREECRYPTOAPI_KEY set, else Yahoo.
 * Stocks: Finnhub when FINNHUB_KEY set and US ticker, else Yahoo.
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

  // US stocks: try Finnhub first when key is set
  if (getFinnhubApiKey() && yahooSymbol === normalized) {
    const finnhubData = await fetchPriceFromFinnhub(normalized);
    if (finnhubData) return finnhubData;
  }

  const data = await getPriceData(yahooSymbol);
  if (!data) return null;
  return { ...data, symbol: normalized };
}

const BATCH_CONCURRENCY = 3; // Limit parallel Yahoo fetches to avoid connection limits in containers

/**
 * Get price data for all holdings; returns Map keyed by original symbol (e.g. NVDA, BTC).
 * Fetches in small batches to avoid ETIMEDOUT in production (e.g. Railway).
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
  return map;
}

/**
 * Check if price move is significant (>5% change)
 */
export function isSignificantPriceMove(priceData: PriceData): boolean {
  return Math.abs(priceData.changePercent) > 5;
}
