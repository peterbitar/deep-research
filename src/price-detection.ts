// Price move detection for trigger system
// Detects unexplained price moves using Yahoo Finance API (free tier)

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
 * Map our symbol to Yahoo Finance symbol (crypto uses -USD suffix).
 */
export function getYahooSymbol(symbol: string): string {
  const s = symbol.toUpperCase().trim();
  const mapping: Record<string, string> = {
    BTC: 'BTC-USD',
    ETH: 'ETH-USD',
    SOL: 'SOL-USD',
    DXY: 'DX-Y.NYB', // US Dollar Index
  };
  return mapping[s] ?? s;
}

/**
 * Get price data for a holding using Yahoo Finance API
 * For MVP: Uses yahoo-finance2 package (free, no API key needed)
 */
export async function getPriceData(symbol: string): Promise<PriceData | null> {
  try {
    // For MVP, we'll use a simple fetch approach with Yahoo Finance's free API
    // In production, consider using yahoo-finance2 npm package
    
    // Yahoo Finance free API endpoint (unofficial but stable)
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=7d`;
    
    const response = await fetch(url);
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
    
    const timestamps = result.timestamp;
    const quotes = result.indicators.quote[0];
    const closes = quotes.close;
    
    // Get first and last valid prices
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
  } catch (error) {
    console.warn(`Error fetching price data for ${symbol}:`, error);
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
 * Returns PriceData keyed by the original symbol.
 */
export async function getPriceDataForHolding(
  ourSymbol: string
): Promise<PriceData | null> {
  const yahooSymbol = getYahooSymbol(ourSymbol);
  const data = await getPriceData(yahooSymbol);
  if (!data) return null;
  return { ...data, symbol: ourSymbol.toUpperCase() };
}

/**
 * Get price data for all holdings; returns Map keyed by original symbol (e.g. NVDA, BTC).
 * Use at the start of a pipeline so prompts can inject "reference prices" from Yahoo.
 */
export async function getPriceDataBatchForHoldings(holdings: {
  symbol: string;
}[]): Promise<Map<string, PriceData>> {
  const symbols = [...new Set(holdings.map((h) => h.symbol.toUpperCase()))];
  const map = new Map<string, PriceData>();
  const results = await Promise.all(
    symbols.map((sym) => getPriceDataForHolding(sym))
  );
  for (const data of results) {
    if (data) map.set(data.symbol, data);
  }
  return map;
}

/**
 * Check if price move is significant (>5% change)
 */
export function isSignificantPriceMove(priceData: PriceData): boolean {
  return Math.abs(priceData.changePercent) > 5;
}
