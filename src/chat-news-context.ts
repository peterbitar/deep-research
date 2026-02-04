/**
 * Hybrid news context manager for chat endpoint.
 *
 * Uses the same logic as report cards + holding checkup:
 * 1. Existing news brief cards from database (fast, cached)
 * 2. Fresh news for uncovered tickers via newsBriefOpenAI (same pipeline as generating cards)
 * 3. Holding checkup for mentioned tickers (same logic as /api/holding-checkup)
 * All of the above are merged into the knowledge base so chat can answer without web search.
 */

import { getReportCards } from './db/reports';
import { generateHoldingCheckup } from './investor-checkup';
import { newsBriefOpenAI } from './news-brief-openai';
import { getPriceDataBatchForHoldings } from './price-detection';
import type { PriceData } from './price-detection';

export interface HoldingEntry {
  symbol: string;
  type: string;
  name: string;
}

interface FreshNewsCache {
  learnings: string[];
  urls: string[];
  fetchedAt: number;
}

interface CheckupCacheEntry {
  text: string;
  fetchedAt: number;
}

interface ChatSessionMetadata {
  newsBriefContext?: {
    runId: string;
    loadedAt: number;
    tickers: string[];
  };
  freshNewsCache?: Map<string, FreshNewsCache>;
  /** Cache of holding checkup text by symbol (JSON-serializable). */
  checkupCache?: Record<string, CheckupCacheEntry>;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Load existing news brief context from database.
 * Extracts covered tickers from report cards.
 *
 * @param runId Optional specific run ID; defaults to latest
 * @returns formatted knowledge base text + list of covered tickers
 */
async function loadExistingNewsContext(runId?: string): Promise<{
  text: string;
  tickers: string[];
  runId: string;
}> {
  try {
    const report = await getReportCards(runId);
    if (!report) {
      return { text: '', tickers: [], runId: '' };
    }

    // Extract tickers from cards
    const tickerSet = new Set<string>();
    const cardTexts: string[] = [];

    for (const card of report.cards) {
      // Add explicit ticker if present
      if (card.ticker) {
        tickerSet.add(card.ticker);
      }

      // Try to extract from title using fuzzy matching
      const titleTickers = extractTickersFromText(card.title);
      titleTickers.forEach(t => tickerSet.add(t));

      // Format card for display
      const cardText = `### ${card.emoji || '📰'} ${card.title}
${card.content}`;
      cardTexts.push(cardText);
    }

    const formattedText = cardTexts.length > 0
      ? `## Latest News Brief\n\n${cardTexts.join('\n\n')}`
      : '';

    console.log(
      `[Hybrid News] Loaded existing news: ${tickerSet.size} tickers covered (run: ${report.runId})`
    );

    return {
      text: formattedText,
      tickers: Array.from(tickerSet),
      runId: report.runId,
    };
  } catch (error) {
    console.warn('[Hybrid News] Failed to load existing news context:', error);
    return { text: '', tickers: [], runId: '' };
  }
}

/**
 * Fetch fresh news for specific tickers using newsBriefOpenAI.
 * Uses non-reasoning mode (fast) and skips macro pass (Pass 3).
 * Optional reference prices ensure the model cites correct price data.
 *
 * @param tickers symbols to fetch news for
 * @param sessionCache session-level cache for TTL tracking
 * @param referencePrices optional map of symbol -> price data for accurate citations
 * @returns learnings + URLs for provided tickers
 */
async function fetchFreshNewsForTickers(
  tickers: string[],
  sessionCache: Map<string, FreshNewsCache>,
  referencePrices?: Map<string, PriceData>
): Promise<{ learnings: string[]; urls: string[] }> {
  if (tickers.length === 0) {
    return { learnings: [], urls: [] };
  }

  const now = Date.now();
  const allLearnings: string[] = [];
  const allUrls: string[] = [];
  const tickersToFetch: string[] = [];

  // Check cache for each ticker
  for (const ticker of tickers) {
    const cached = sessionCache.get(ticker);
    if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
      // Use cached result
      console.log(`[Hybrid News] Using cached news for: ${ticker}`);
      allLearnings.push(...cached.learnings);
      allUrls.push(...cached.urls);
    } else {
      tickersToFetch.push(ticker);
    }
  }

  // Fetch news for uncached tickers (one call per ticker so cache stays correct per symbol)
  if (tickersToFetch.length > 0) {
    console.log(`[Hybrid News] Fetching fresh news for: ${tickersToFetch.join(', ')}`);
    try {
      for (const ticker of tickersToFetch) {
        const holdings: HoldingEntry[] = [
          { symbol: ticker, type: 'stock', name: ticker },
        ];
        const result = await newsBriefOpenAI({
          holdings,
          mode: 'non-reasoning',
          includeMacro: false,
          referencePrices,
        });
        const entry: FreshNewsCache = {
          learnings: result.learnings,
          urls: result.urls,
          fetchedAt: now,
        };
        sessionCache.set(ticker, entry);
        allLearnings.push(...result.learnings);
        allUrls.push(...result.urls);
      }
      console.log(
        `[Hybrid News] Fetched fresh news: ${tickersToFetch.length} ticker(s)`
      );
    } catch (error) {
      console.warn('[Hybrid News] Failed to fetch fresh news:', error);
    }
  }

  return { learnings: allLearnings, urls: allUrls };
}

/**
 * Main entry point: Get hybrid news context (existing + fresh).
 *
 * Flow:
 * 1. Load existing news brief from DB (cached in session)
 * 2. Extract tickers from user message
 * 3. Identify uncovered tickers
 * 4. Fetch reference prices for uncovered tickers
 * 5. Fetch fresh news for missing tickers (with reference prices for correct citations)
 * 6. Merge results
 *
 * @param userMessage user's chat message
 * @param sessionMetadata session-level metadata object (persisted across requests)
 * @returns formatted knowledge base text + updated session metadata
 */
export async function getHybridNewsContext(
  userMessage: string,
  sessionMetadata: ChatSessionMetadata = {}
): Promise<{
  knowledgeBaseText: string;
  updatedMetadata: ChatSessionMetadata;
  hadExistingNews: boolean;
  hadFreshNews: boolean;
  freshNewsTickers: string[];
}> {
  // Initialize cache if needed
  if (!sessionMetadata.freshNewsCache) {
    sessionMetadata.freshNewsCache = new Map();
  }

  // Step 1: Load existing news (cache in session after first load)
  let existingNews = { text: '', tickers: [], runId: '' };
  if (sessionMetadata.newsBriefContext) {
    // Use cached existing news
    const cache = sessionMetadata.newsBriefContext;
    const now = Date.now();
    if (now - cache.loadedAt < CACHE_TTL_MS) {
      console.log('[Hybrid News] Using cached existing news');
      // Reconstruct text from cached tickers (simplified)
      existingNews = {
        text: cache.tickers.length > 0
          ? `(News brief context: ${cache.tickers.join(', ')} covered)`
          : '',
        tickers: cache.tickers,
        runId: cache.runId,
      };
    }
  } else {
    // Load fresh existing news
    existingNews = await loadExistingNewsContext();
    if (existingNews.tickers.length > 0) {
      sessionMetadata.newsBriefContext = {
        runId: existingNews.runId,
        loadedAt: Date.now(),
        tickers: existingNews.tickers,
      };
    }
  }

  // Step 2: Extract tickers from user message
  const userTickers = extractTickersFromText(userMessage);
  console.log(`[Hybrid News] Extracted tickers from user message: ${userTickers.join(', ') || 'none'}`);

  // Step 3: Identify uncovered tickers
  const uncoveredTickers = userTickers.filter(
    ticker => !existingNews.tickers.includes(ticker)
  );
  if (uncoveredTickers.length > 0) {
    console.log(`[Hybrid News] Uncovered tickers: ${uncoveredTickers.join(', ')}`);
  }

  // Step 4: Fetch reference prices for uncovered tickers (so news brief cites correct numbers)
  let referencePrices: Map<string, PriceData> | undefined;
  if (uncoveredTickers.length > 0) {
    const holdingsForPrice = uncoveredTickers.map((symbol) => ({
      symbol,
      type: 'stock' as string,
      name: symbol,
    }));
    referencePrices = await getPriceDataBatchForHoldings(holdingsForPrice);
  }

  // Step 5: Fetch fresh news for uncovered tickers
  let freshNews = { learnings: [], urls: [] };
  if (uncoveredTickers.length > 0) {
    freshNews = await fetchFreshNewsForTickers(
      uncoveredTickers,
      sessionMetadata.freshNewsCache,
      referencePrices
    );
  }

  // Step 6: Merge results into single knowledge base text
  const knowledgeBaseParts: string[] = [];

  if (existingNews.text) {
    knowledgeBaseParts.push(existingNews.text);
  }

  if (freshNews.learnings.length > 0) {
    const freshNewsText = `## Fresh News Context\n\n${freshNews.learnings.join('\n')}`;
    knowledgeBaseParts.push(freshNewsText);
  }

  // Step 7: Add holding checkups for tickers mentioned (same logic as /api/holding-checkup)
  const MAX_CHECKUPS = 5;
  const tickersForCheckup = userTickers.slice(0, MAX_CHECKUPS);
  if (tickersForCheckup.length > 0) {
    if (!sessionMetadata.checkupCache) {
      sessionMetadata.checkupCache = {};
    }
    const checkupParts: string[] = [];
    const now = Date.now();
    let reportForCheckup: Awaited<ReturnType<typeof getReportCards>> | null = null;

    for (const symbol of tickersForCheckup) {
      const cached = sessionMetadata.checkupCache[symbol];
      if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
        checkupParts.push(`### ${symbol}\n${cached.text}`);
        continue;
      }
      try {
        if (!reportForCheckup) reportForCheckup = await getReportCards();
        const newsBriefContext =
          reportForCheckup?.cards?.length || reportForCheckup?.opening
            ? {
                opening: reportForCheckup.opening ?? '',
                cards: (reportForCheckup.cards ?? []).map((c) => ({
                  title: c.title ?? '',
                  content: c.content ?? '',
                })),
                publishedDate: reportForCheckup.publishedDate,
              }
            : undefined;
        const { checkup } = await generateHoldingCheckup(
          { symbol, name: symbol },
          { newsBriefContext }
        );
        if (checkup?.trim()) {
          sessionMetadata.checkupCache![symbol] = { text: checkup.trim(), fetchedAt: now };
          checkupParts.push(`### ${symbol}\n${checkup.trim()}`);
        }
      } catch (err) {
        console.warn(`[Hybrid News] Checkup failed for ${symbol}:`, err);
      }
    }

    if (checkupParts.length > 0) {
      knowledgeBaseParts.push(`## Holding checkups\n\n${checkupParts.join('\n\n')}`);
    }
  }

  const knowledgeBaseText = knowledgeBaseParts.join('\n\n');
  const hadExistingNews = existingNews.text.length > 0;
  const hadFreshNews = freshNews.learnings.length > 0;

  return {
    knowledgeBaseText,
    updatedMetadata: sessionMetadata,
    /** True when we loaded existing news brief cards from DB. */
    hadExistingNews,
    /** True when we fetched fresh news for uncovered tickers this request. */
    hadFreshNews,
    /** Tickers we fetched fresh news for (when hadFreshNews). */
    freshNewsTickers: hadFreshNews ? uncoveredTickers : [],
  };
}

/** Company / asset names (lowercase) to ticker symbol. Used for whole-word matching in messages. */
const COMPANY_NAME_TO_SYMBOL: Record<string, string> = {
  apple: 'AAPL',
  microsoft: 'MSFT',
  tesla: 'TSLA',
  nvidia: 'NVDA',
  amazon: 'AMZN',
  google: 'GOOGL',
  meta: 'META',
  alphabet: 'GOOGL',
  netflix: 'NFLX',
  bitcoin: 'BTC',
  ethereum: 'ETH',
  ether: 'ETH',
  solana: 'SOL',
  dogecoin: 'DOGE',
  doge: 'DOGE',
  ripple: 'XRP',
  xrp: 'XRP',
  gold: 'GLD',
  silver: 'SLV',
  spy: 'SPY',
  qqq: 'QQQ',
  's&p 500': 'SPY',
  's&p500': 'SPY',
  jpmorgan: 'JPM',
  'jp morgan': 'JPM',
  berkshire: 'BRK.B',
  visa: 'V',
  mastercard: 'MA',
  costco: 'COST',
  walmart: 'WMT',
  disney: 'DIS',
  'walt disney': 'DIS',
  intel: 'INTC',
  amd: 'AMD',
  qualcomm: 'QCOM',
  oracle: 'ORCL',
  salesforce: 'CRM',
  adobe: 'ADBE',
  ibm: 'IBM',
};

/**
 * Extract ticker symbols from text: (1) explicit tickers like AAPL, (2) company names like "Apple".
 */
function extractTickersFromText(text: string): string[] {
  const tickerPattern = /(?:^|[\s$\(,])([A-Z0-9]{1,5})(?=[\s\)\.,;:!?]|$)/g;
  const commonWords = new Set([
    'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT',
    'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO',
    'BOY', 'DID', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'HAD', 'WITH', 'THIS', 'WEEK', 'THAT', 'FROM',
    'INTO', 'ONLY', 'OVER', 'UNDER', 'AFTER', 'BEFORE', 'ABOUT', 'ABOVE', 'BELOW', 'BETWEEN', 'AMONG',
    'STOCK', 'PRICE', 'SHARES', 'MARKET', 'TRADING', 'EARNINGS', 'REVENUE', 'GROWTH', 'SALES', 'PROFIT',
  ]);

  const matches = new Set<string>();

  // 1) Explicit tickers (e.g. AAPL, BTC)
  let match;
  while ((match = tickerPattern.exec(text)) !== null) {
    const symbol = match[1];
    if (
      symbol.length >= 2 &&
      !commonWords.has(symbol) &&
      /[A-Z]/.test(symbol)
    ) {
      matches.add(symbol);
    }
  }

  // 2) Company/asset names as whole words (e.g. "Apple", "Bitcoin")
  const lower = text.toLowerCase();
  for (const [name, symbol] of Object.entries(COMPANY_NAME_TO_SYMBOL)) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(lower)) matches.add(symbol);
  }

  return Array.from(matches);
}
