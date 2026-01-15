// Price move detection for trigger system
// Detects unexplained price moves using Yahoo Finance API (free tier)

export type PriceData = {
  symbol: string;
  currentPrice: number;
  price7DaysAgo: number;
  changePercent: number;
  changeAbsolute: number;
};

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
    
    return {
      symbol,
      currentPrice,
      price7DaysAgo,
      changePercent,
      changeAbsolute,
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
 * Check if price move is significant (>5% change)
 */
export function isSignificantPriceMove(priceData: PriceData): boolean {
  return Math.abs(priceData.changePercent) > 5;
}
