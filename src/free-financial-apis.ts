/**
 * Free Financial APIs: Alpha Vantage + SEC EDGAR
 * Fallback sources for price data and SEC filings when Finnhub rate-limited
 */

const ALPHA_VANTAGE_TIMEOUT_MS = 30_000; // Increased for network latency
const SEC_EDGAR_TIMEOUT_MS = 20_000; // Increased for network latency

// ============== Interfaces ==============

export interface AlphaVantageQuote {
  'Global Quote': {
    '01. symbol'?: string;
    '02. open'?: string;
    '03. high'?: string;
    '04. low'?: string;
    '05. price'?: string;
    '06. volume'?: string;
    '07. latest trading day'?: string;
    '08. previous close'?: string;
    '09. change'?: string;
    '10. change percent'?: string;
  };
}

export interface AlphaVantageTimeSeries {
  'Meta Data'?: {
    '1. Information'?: string;
    '2. Symbol'?: string;
    '3. Last Refreshed'?: string;
    '4. Output Size'?: string;
    '5. Time Zone'?: string;
  };
  'Time Series (Daily)'?: Record<string, {
    '1. open': string;
    '2. high': string;
    '3. low': string;
    '4. close': string;
    '5. volume': string;
  }>;
}

export interface SECFiling {
  accessNumber: string;
  filingDate: string;
  reportDate: string;
  acceptanceDateTime: string;
  act: string;
  form: string;
  fileNumber: string;
  filmNumber: string;
  items: string;
  size: string;
  isXBRL: number;
  isInlineXBRL: number;
  primaryDocument: string;
  primaryDocDescription: string;
}

export interface SECCompanyFacts {
  cik: string;
  entityType: string;
  name: string;
  taxonomy: Record<string, any>;
  facts: Record<string, Record<string, any>>;
}

// ============== API Key Management ==============

export function getAlphaVantageApiKey(): string | undefined {
  const raw = process.env.ALPHA_VANTAGE_KEY ?? process.env.ALPHAVANTAGE_KEY;
  if (typeof raw !== 'string') return undefined;
  const key = raw.replace(/^["']|["']$/g, '').trim();
  return key || undefined;
}

// SEC EDGAR API is free and doesn't require a key

// ============== Alpha Vantage Functions ==============

/**
 * Fetch current quote from Alpha Vantage
 * Better accuracy than Yahoo Finance for 7-day pricing
 */
export async function fetchAlphaVantageQuote(symbol: string): Promise<{ currentPrice: number; previousClose: number } | null> {
  if (!symbol) return null;

  const apiKey = getAlphaVantageApiKey();
  if (!apiKey) return null;

  const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ALPHA_VANTAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      console.warn(`Alpha Vantage quote ${symbol}: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as AlphaVantageQuote;
    const quote = data['Global Quote'];

    if (!quote || !quote['05. price']) {
      console.warn(`Alpha Vantage quote ${symbol}: invalid data`);
      return null;
    }

    const currentPrice = parseFloat(quote['05. price']);
    const previousClose = parseFloat(quote['08. previous close'] || quote['05. price']);

    if (!Number.isFinite(currentPrice) || !Number.isFinite(previousClose)) {
      console.warn(`Alpha Vantage quote ${symbol}: non-finite prices`);
      return null;
    }

    console.log(`Alpha Vantage quote ${symbol}: $${currentPrice.toFixed(2)}, prev close: $${previousClose.toFixed(2)}`);

    return { currentPrice, previousClose };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort') || msg.includes('ETIMEDOUT')) {
      console.warn(`Alpha Vantage quote ${symbol}: timeout (${ALPHA_VANTAGE_TIMEOUT_MS}ms)`);
    } else {
      console.warn(`Alpha Vantage quote ${symbol}: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch daily time series (7+ days) from Alpha Vantage
 * Returns data from past 7-10 days for accurate 7-day change
 */
export async function fetchAlphaVantageTimeSeries(symbol: string): Promise<AlphaVantageTimeSeries | null> {
  if (!symbol) return null;

  const apiKey = getAlphaVantageApiKey();
  if (!apiKey) return null;

  // outputsize=full returns up to 20 years, outputsize=compact returns last 100 days
  const url = `https://www.alphavantage.co/query?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${encodeURIComponent(apiKey)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), ALPHA_VANTAGE_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      console.warn(`Alpha Vantage time series ${symbol}: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as AlphaVantageTimeSeries;

    if (!data['Time Series (Daily)'] || Object.keys(data['Time Series (Daily)']).length === 0) {
      console.warn(`Alpha Vantage time series ${symbol}: no data`);
      return null;
    }

    console.log(`Alpha Vantage time series ${symbol}: ${Object.keys(data['Time Series (Daily)']).length} days`);
    return data;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort') || msg.includes('ETIMEDOUT')) {
      console.warn(`Alpha Vantage time series ${symbol}: timeout`);
    } else {
      console.warn(`Alpha Vantage time series ${symbol}: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

// ============== SEC EDGAR Functions ==============

/**
 * Fetch SEC filings from EDGAR (free, no API key required)
 * Returns recent filings for a given CIK
 */
export async function fetchSECFilings(cik: string): Promise<SECFiling[]> {
  if (!cik) return [];

  // Normalize CIK (pad with zeros)
  const normalizedCIK = cik.padStart(10, '0');

  // Official SEC EDGAR API endpoint
  const url = `https://data.sec.gov/submissions/CIK${normalizedCIK}.json`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEC_EDGAR_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      console.warn(`SEC EDGAR filings CIK${normalizedCIK}: ${response.status} ${response.statusText}`);
      return [];
    }

    const data = (await response.json()) as {
      filings?: {
        recent?: SECFiling[];
        files?: Array<{ name: string }>;
      };
    };

    const filings = data.filings?.recent ?? [];
    console.log(`SEC EDGAR CIK${normalizedCIK}: found ${filings.length} filings`);

    return filings;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort') || msg.includes('ETIMEDOUT')) {
      console.warn(`SEC EDGAR filings CIK${normalizedCIK}: timeout`);
    } else {
      console.warn(`SEC EDGAR filings CIK${normalizedCIK}: ${msg}`);
    }
    return [];
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetch company ticker to CIK mapping from SEC EDGAR
 * Used to convert ticker symbol to CIK for filing lookups
 */
export async function fetchSECTickerToCIK(ticker: string): Promise<string | null> {
  if (!ticker) return null;

  const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${encodeURIComponent(ticker)}&type=&dateb=&owner=exclude&count=100&output=json`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEC_EDGAR_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });

    if (!response.ok) {
      console.warn(`SEC EDGAR ticker lookup ${ticker}: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      cik_lookup?: {
        [key: string]: string;
      };
    };

    const cik = data.cik_lookup?.[ticker.toUpperCase()];
    if (cik) {
      console.log(`SEC EDGAR ticker ${ticker}: CIK ${cik}`);
      return cik;
    }

    console.warn(`SEC EDGAR ticker lookup ${ticker}: no CIK found`);
    return null;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('abort') || msg.includes('ETIMEDOUT')) {
      console.warn(`SEC EDGAR ticker lookup ${ticker}: timeout`);
    } else {
      console.warn(`SEC EDGAR ticker lookup ${ticker}: ${msg}`);
    }
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Get recent SEC filings for a stock by ticker
 * Converts ticker to CIK, then fetches filings
 */
export async function fetchSECFilingsByTicker(ticker: string, limit: number = 5): Promise<SECFiling[]> {
  const cik = await fetchSECTickerToCIK(ticker);
  if (!cik) return [];

  const allFilings = await fetchSECFilings(cik);

  // Filter to main forms (10-K, 10-Q, 8-K, 20-F, etc.) and limit results
  const mainForms = new Set(['10-K', '10-Q', '8-K', '20-F', '424B5', '424B4', '424B3', '424B2', '424B1']);
  return allFilings.filter((f) => mainForms.has(f.form)).slice(0, limit);
}
