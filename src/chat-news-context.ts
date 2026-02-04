/**
 * Hybrid news context manager for chat endpoint.
 *
 * Provides two layers of news integration:
 * 1. Existing news brief cards from database (fast, cached)
 * 2. Fresh news fetch for uncovered tickers (on-demand)
 */

import { getReportCards } from './db/reports';
import { newsBriefOpenAI } from './news-brief-openai';

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

interface ChatSessionMetadata {
  newsBriefContext?: {
    runId: string;
    loadedAt: number;
    tickers: string[];
  };
  freshNewsCache?: Map<string, FreshNewsCache>;
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
 *
 * @param tickers symbols to fetch news for
 * @param sessionCache session-level cache for TTL tracking
 * @returns learnings + URLs for provided tickers
 */
async function fetchFreshNewsForTickers(
  tickers: string[],
  sessionCache: Map<string, FreshNewsCache>
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

  // Fetch news for uncached tickers
  if (tickersToFetch.length > 0) {
    console.log(`[Hybrid News] Fetching fresh news for: ${tickersToFetch.join(', ')}`);
    try {
      const holdings: HoldingEntry[] = tickersToFetch.map(symbol => ({
        symbol,
        type: 'stock',
        name: symbol,
      }));

      const result = await newsBriefOpenAI({
        holdings,
        mode: 'non-reasoning', // Fast mode
        includeMacro: false, // Skip macro pass
      });

      // Cache results
      for (const ticker of tickersToFetch) {
        sessionCache.set(ticker, {
          learnings: result.learnings,
          urls: result.urls,
          fetchedAt: now,
        });
      }

      allLearnings.push(...result.learnings);
      allUrls.push(...result.urls);

      console.log(
        `[Hybrid News] Fetched fresh news: ${tickersToFetch.length} ticker(s), ${result.learnings.length} learnings`
      );
    } catch (error) {
      console.warn('[Hybrid News] Failed to fetch fresh news:', error);
      // Gracefully degrade - proceed without fresh news
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
 * 4. Fetch fresh news for missing tickers
 * 5. Merge results
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

  // Step 4: Fetch fresh news for uncovered tickers
  let freshNews = { learnings: [], urls: [] };
  if (uncoveredTickers.length > 0) {
    freshNews = await fetchFreshNewsForTickers(
      uncoveredTickers,
      sessionMetadata.freshNewsCache
    );
  }

  // Step 5: Merge results into single knowledge base text
  const knowledgeBaseParts: string[] = [];

  if (existingNews.text) {
    knowledgeBaseParts.push(existingNews.text);
  }

  if (freshNews.learnings.length > 0) {
    const freshNewsText = `## Fresh News Context\n\n${freshNews.learnings.join('\n')}`;
    knowledgeBaseParts.push(freshNewsText);
  }

  const knowledgeBaseText = knowledgeBaseParts.join('\n\n');

  return {
    knowledgeBaseText,
    updatedMetadata: sessionMetadata,
  };
}

/**
 * Extract ticker symbols from text using simple pattern matching.
 * Matches 1-5 uppercase alphanumeric characters with word boundaries.
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
  let match;

  while ((match = tickerPattern.exec(text)) !== null) {
    const symbol = match[1];
    // Filter: length >= 2, not a common word, has at least one letter
    if (
      symbol.length >= 2 &&
      !commonWords.has(symbol) &&
      /[A-Z]/.test(symbol)
    ) {
      matches.add(symbol);
    }
  }

  return Array.from(matches);
}
