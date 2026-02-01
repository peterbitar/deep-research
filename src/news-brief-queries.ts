/**
 * News brief query generator: 3-pass sequenced logic per asset.
 * Pass 1: Price + structure | Pass 2: Company/asset internal news | Pass 3: Macro + correlation.
 * Queries are time-bound (month/year) and site-specific for precision.
 */

/** Minimal asset shape for query generation (same as HoldingEntry). */
export interface AssetForQueries {
  symbol: string;
  type: string;
  name: string;
}

export type AssetKind = 'stock' | 'etf' | 'crypto';

const KNOWN_ETFS = new Set(['SPY', 'QQQ', 'GLD', 'GLDM', 'SLV', 'IAU', 'SPXL', 'TLT', 'IWM']);

function assetKind(h: AssetForQueries): AssetKind {
  const t = h.type.toLowerCase();
  if (t === 'cryptocurrency' || h.symbol === 'BTC' || h.symbol === 'ETH') return 'crypto';
  if (t === 'etf' || KNOWN_ETFS.has(h.symbol.toUpperCase())) return 'etf';
  return 'stock';
}

const now = new Date();
const month = now.toLocaleString('en-US', { month: 'long' });
const year = now.getFullYear();
const monthYear = `${month} ${year}`;

export interface QueriesByPass {
  pass1: string[];
  pass2: string[];
  pass3: string[];
}

/**
 * Generate grouped queries for one asset in sequence: Pass 1 (price/structure), Pass 2 (internal), Pass 3 (macro).
 * Uses time-bound queries (e.g. "January 2026") and Tier 1 sites for precision.
 */
export function generateQueriesForAsset(asset: AssetForQueries): QueriesByPass {
  const { symbol: ticker, name } = asset;
  const kind = assetKind(asset);
  const queries: QueriesByPass = { pass1: [], pass2: [], pass3: [] };

  // Pass 1 – Real-time: price, support/resistance, liquidations, volume (verify market data)
  queries.pass1.push(`${ticker} price movement last 7 days site:tradingview.com`);
  queries.pass1.push(`${name} support resistance site:investing.com`);
  if (kind === 'crypto') {
    queries.pass1.push(`${ticker} price drop support level broken ${monthYear} site:coindesk.com`);
    queries.pass1.push(`${name} price chart ${monthYear} site:bloomberg.com`);
    queries.pass1.push(`${ticker} liquidations ${monthYear} site:coinglass.com`);
    queries.pass1.push(`${name} funding rate trend site:theblock.co`);
    queries.pass1.push(`${name} trading volume last 7 days site:coindesk.com`);
    queries.pass1.push(`${name} analyst positioning trader sentiment site:coindesk.com`);
  } else if (kind === 'stock') {
    queries.pass1.push(`${ticker} trading volume last 7 days site:yahoo.com`);
    queries.pass1.push(`${ticker} volume spike ${monthYear} site:yahoo.com`);
    queries.pass1.push(`${ticker} analyst positioning site:bloomberg.com`);
  } else if (kind === 'etf') {
    queries.pass1.push(`${name} ETF volume flows ${monthYear} site:etf.com`);
  }

  // Pass 2 – Company/asset internal news (partnerships, filings, ETF flows)
  if (kind === 'stock') {
    queries.pass2.push(`${name} earnings Q4 ${year} site:bloomberg.com`);
    queries.pass2.push(`${name} partnership news ${year} site:reuters.com`);
    queries.pass2.push(`${name} investment news ${year} site:techcrunch.com`);
    queries.pass2.push(`${ticker} guidance site:wsj.com`);
    queries.pass2.push(`${ticker} 8-K filing site:sec.gov`);
  } else if (kind === 'etf') {
    queries.pass2.push(`${name} ETF inflows outflows ${monthYear} site:etf.com`);
    queries.pass2.push(`${name} rebalancing site:morningstar.com`);
  } else if (kind === 'crypto') {
    queries.pass2.push(`Bitcoin ETF inflows ${monthYear} site:theblock.co`);
    queries.pass2.push(`${name} ETF news ${monthYear} site:bloomberg.com`);
    queries.pass2.push(`${name} ETF inflows outflows ${monthYear} site:coindesk.com`);
    queries.pass2.push(`${name} regulation institutional site:coindesk.com`);
    queries.pass2.push(`${name} flow data site:theblock.co`);
  }

  // Pass 3 – Macro + per-asset correlation
  queries.pass3.push(`${name} macro correlation Nasdaq S&P ${monthYear} site:bloomberg.com`);
  return queries;
}

/** Macro / commodity queries (shared across all holdings). Time-bound, Tier 1 sites. */
const MACRO_QUERIES = [
  `CPI ${month} ${year} report site:reuters.com`,
  `DXY dollar strength ${monthYear} site:investing.com`,
  `Fed rate expectations site:ft.com`,
  `Fed chair hawkish dovish ${monthYear} site:bloomberg.com`,
  `Silver gold commodity move reason ${monthYear} site:marketwatch.com`,
];

/**
 * All queries in sequence: for each holding Pass 1 then Pass 2; then one shared Pass 3 (macro) plus per-holding correlation.
 */
export function generateAllQueries(
  holdings: AssetForQueries[],
  includeMacro: boolean
): Array<{ holding: AssetForQueries | null; pass: 1 | 2 | 3; queries: string[] }> {
  const out: Array<{ holding: AssetForQueries | null; pass: 1 | 2 | 3; queries: string[] }> = [];
  for (const h of holdings) {
    const q = generateQueriesForAsset(h);
    out.push({ holding: h, pass: 1, queries: q.pass1 });
    out.push({ holding: h, pass: 2, queries: q.pass2 });
  }
  if (includeMacro) {
    const correlationQueries = holdings.map((h) => generateQueriesForAsset(h).pass3);
    const allPass3 = [...MACRO_QUERIES, ...correlationQueries.flat()];
    out.push({ holding: null, pass: 3, queries: allPass3 });
  }
  return out;
}
