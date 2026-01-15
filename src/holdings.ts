// Holdings parsing and validation

export type AssetType = 'stock' | 'crypto' | 'commodity' | 'unknown';

export interface Holding {
  symbol: string;
  type: AssetType;
  name?: string;
}

// Common crypto symbols
const CRYPTO_SYMBOLS = new Set([
  'BTC', 'BITCOIN',
  'ETH', 'ETHEREUM',
  'SOL', 'SOLANA',
  'ADA', 'CARDANO',
  'DOT', 'POLKADOT',
  'MATIC', 'POLYGON',
  'AVAX', 'AVALANCHE',
  'ATOM', 'COSMOS',
  'LINK', 'CHAINLINK',
  'UNI', 'UNISWAP',
  'AAVE', 'AVALANCHE',
  'ALGO', 'ALGORAND',
  'XRP', 'RIPPLE',
  'LTC', 'LITECOIN',
  'BCH', 'BITCOIN CASH',
  'ETC', 'ETHEREUM CLASSIC',
]);

// Common commodity symbols
const COMMODITY_SYMBOLS = new Set([
  'OIL', 'CL', 'WTI', 'BRENT', 'CRUDE',
  'GOLD', 'XAU',
  'SILVER', 'XAG',
  'COPPER', 'HG',
  'NATURAL GAS', 'NG',
  'PLATINUM', 'XPT',
  'PALLADIUM', 'XPD',
]);

/**
 * Detect asset type from symbol
 */
export function detectAssetType(symbol: string): AssetType {
  const upperSymbol = symbol.toUpperCase().trim();
  
  if (CRYPTO_SYMBOLS.has(upperSymbol)) {
    return 'crypto';
  }
  
  if (COMMODITY_SYMBOLS.has(upperSymbol)) {
    return 'commodity';
  }
  
  // Assume stock for everything else (could be enhanced with stock exchange validation)
  return 'stock';
}

/**
 * Parse holdings from comma-separated string or array
 */
export function parseHoldings(input: string | string[]): Holding[] {
  const symbols: string[] = Array.isArray(input)
    ? input
    : input.split(',').map(s => s.trim()).filter(s => s.length > 0);
  
  return symbols.map(symbol => ({
    symbol: symbol.toUpperCase().trim(),
    type: detectAssetType(symbol),
  }));
}

/**
 * Get full name for common assets (optional enhancement)
 */
export function getAssetName(holding: Holding): string {
  const symbol = holding.symbol;
  
  const names: Record<string, string> = {
    'BTC': 'Bitcoin',
    'ETH': 'Ethereum',
    'SOL': 'Solana',
    'AAPL': 'Apple Inc.',
    'NVDA': 'NVIDIA Corporation',
    'MSFT': 'Microsoft Corporation',
    'GOOGL': 'Alphabet Inc.',
    'AMZN': 'Amazon.com Inc.',
    'TSLA': 'Tesla Inc.',
    'META': 'Meta Platforms Inc.',
    'JPM': 'JPMorgan Chase & Co.',
    'XOM': 'Exxon Mobil Corporation',
    'OIL': 'Crude Oil',
    'GOLD': 'Gold',
    'SILVER': 'Silver',
    'TWTR': 'Twitter Inc.',
    'X': 'Twitter Inc.',
    'NFLX': 'Netflix Inc.',
    'CRWD': 'CrowdStrike Holdings',
    'SPY': 'SPDR S&P 500 ETF',
    'SPX': 'S&P 500 Index',
  };
  
  return names[symbol] || symbol;
}

/**
 * Group holdings by type
 */
export function groupHoldingsByType(holdings: Holding[]): {
  stocks: Holding[];
  crypto: Holding[];
  commodities: Holding[];
} {
  return {
    stocks: holdings.filter(h => h.type === 'stock'),
    crypto: holdings.filter(h => h.type === 'crypto'),
    commodities: holdings.filter(h => h.type === 'commodity'),
  };
}
