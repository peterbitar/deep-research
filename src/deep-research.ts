import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from './ai/generate-with-cost-log';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { getModel, trimPrompt } from './ai/providers';
import { logFirecrawlCostAsync } from './cost-logger';
import { savePipelineIteration } from './db/pipeline-stages';
import { parseDateFromMarkdown, parseDateFromUrl } from './parse-date-from-markdown';
import { systemPrompt, reportStylePrompt } from './prompt';
import { PipelineDataSaver } from './pipeline-data-saver';

// Log level system to reduce verbosity and stay under Railway's 500 logs/sec limit
const LOG_LEVEL = (process.env.LOG_LEVEL || 'info').toLowerCase() as 'error' | 'warn' | 'info' | 'debug';
const levels = { error: 0, warn: 1, info: 2, debug: 3 };

function log(level: 'error' | 'warn' | 'info' | 'debug', ...args: any[]) {
  if (levels[level] <= levels[LOG_LEVEL]) {
    if (level === 'error') {
      console.error(...args);
    } else if (level === 'warn') {
      console.warn(...args);
    } else {
      console.log(...args);
    }
  }
}

// Backward compatibility: default to 'info' level if no level specified
function logInfo(...args: any[]) {
  log('info', ...args);
}

export type ResearchProgress = {
  currentDepth: number;
  totalDepth: number;
  currentBreadth: number;
  totalBreadth: number;
  currentQuery?: string;
  totalQueries: number;
  completedQueries: number;
};

type ResearchResult = {
  learnings: string[];
  visitedUrls: string[];
};

// increase this if you have higher API rate limits
const ConcurrencyLimit = Number(process.env.FIRECRAWL_CONCURRENCY) || 2;

// Initialize Firecrawl with optional API key and optional base url

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds
const MAX_RETRY_DELAY = 60000; // 60 seconds

// Helper function to sleep
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Extract retry-after from error message or use default
function getRetryAfter(error: any): number {
  // Try to extract retry-after from error message (handles "retry after Xs" or "try again after Xs")
  const retryAfterMatch = error.message?.match(/(?:retry|try again) after (\d+)s?/i);
  if (retryAfterMatch) {
    return parseInt(retryAfterMatch[1]) * 1000; // Convert seconds to ms
  }
  return INITIAL_RETRY_DELAY;
}

// Retry function for Firecrawl API calls
export async function retryFirecrawlSearch<T>(
  searchFn: () => Promise<T>,
  query: string,
  retryCount = 0,
  operation?: 'search' | 'scrape'
): Promise<T> {
  try {
    const result = await searchFn();
    if (operation) {
      const creditsUsed = operation === 'search' ? 0 : 1;
      logFirecrawlCostAsync({ operation, creditsUsed });
    }
    return result;
  } catch (error: any) {
    const statusCode = error.statusCode || error.status;
    const isRetryable = statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503;
    
    // Don't retry on insufficient credits (402) or other non-retryable errors
    if (!isRetryable || retryCount >= MAX_RETRIES) {
      if (statusCode === 402) {
        log('error', `Error running query: ${query}: Insufficient credits. Please upgrade your plan.`);
      } else if (retryCount >= MAX_RETRIES) {
        log('error', `Error running query: ${query}: Max retries (${MAX_RETRIES}) exceeded.`);
      }
      throw error;
    }

    // Calculate delay with exponential backoff
    const retryAfter = getRetryAfter(error);
    const delay = Math.min(
      retryAfter * Math.pow(2, retryCount),
      MAX_RETRY_DELAY
    );

    log('warn', `Error running query: ${query}: ${error.message || error}. Retrying in ${delay/1000}s (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
    
    await sleep(delay);
    return retryFirecrawlSearch(searchFn, query, retryCount + 1, operation);
  }
}

// take en user query, return a list of SERP queries
export async function generateSerpQueries({
  query,
  numQueries = 3,
  learnings,
}: {
  query: string;
  numQueries?: number;

  // optional, if provided, the research will continue from the last learning
  learnings?: string[];
}) {
  // Check if query is about commodities/energy
  const isCommodityQuery = /\b(oil|energy|gas|crude|commodit|natural gas|LNG|petroleum|OPEC|WTI|Brent|gold|silver|XAU|XAG)\b/i.test(query);
  const isCompanyQuery = /\b(NVIDIA|AAPL|MSFT|GOOGL|JPM|XOM|Exxon|company|earnings|stock)\b/i.test(query);
  const isCryptoQuery = /\b(BTC|Bitcoin|XRP|Ripple|ETH|Ethereum|cryptocurrency|crypto|blockchain|digital currency)\b/i.test(query);
  const isETFQuery = /\b(SPY|QQQ|VOO|VTI|ETF|index fund)\b/i.test(query);
  
  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other.

STRICT REQUIREMENTS:
- Focus on information published in the LAST 7 DAYS only
- Prioritize Tier 1 sources: Reuters, Bloomberg, FT, WSJ, company filings, EIA, OPEC, government data
- Avoid consulting blogs, generic outlooks, aggregators (MarketMinute, FinancialContent)

GENERAL QUERY GENERATION STRATEGY (applies to ALL queries):
1. ALWAYS start with at least ONE broad, simple query for general recent news (e.g., "[Topic] news January 2026" or "[Topic] last week")
2. Use flexible date ranges like "January 2026" or "last week" - avoid restrictive "last 7 days" quotes in queries
3. Start broad, then narrow - include general news queries first, then add specific technical queries
4. Don't be too restrictive - include general news queries to catch all developments

${isCommodityQuery ? `FOR COMMODITIES/ENERGY QUERIES (like this one), you MUST:
1. Create at least ONE simple, broad query that searches for general recent news (e.g., "Gold news January 2026" or "Oil prices last week")
2. Include queries about:
   - General recent news and developments (start broad, then narrow)
   - Current price levels and recent price movements (search for actual current prices)
   - PRICE MILESTONES: crashes, spikes, all-time highs (e.g., "gold price crash January 2026" or "silver drop why")
   - Supply vs demand balance (is supply exceeding demand? vice versa?)
   - Inventory levels (are inventories rising or falling?)
   - OPEC/producer behavior (what are producers doing?)
   - Price reactions (why are prices reacting or NOT reacting to developments?)
3. Use date ranges like "January 2026" or "last week" instead of restrictive "last 7 days" quotes
4. Don't be too restrictive - include general news queries to catch all developments` : ''}

${isCompanyQuery ? `FOR COMPANY/STOCK QUERIES, you MUST:
1. Create at least ONE simple, broad query that searches for general recent news (e.g., "NVIDIA news January 2026" or "Apple stock last week")
2. Include queries about:
   - General recent news and developments (start broad, then narrow)
   - Specific company filings or earnings releases
   - PRICE MILESTONES: stock crashes, all-time highs, major drawdowns (e.g., "NVIDIA stock drop January 2026 why")
   - Holdings-level impact (what does this mean for holders?)
   - Company-specific implications (bullish/neutral/bearish? near-term vs long-term?)
3. Use date ranges like "January 2026" or "last week" instead of restrictive "last 7 days" quotes
4. Don't be too restrictive - include general news queries to catch all developments` : ''}

${isCryptoQuery ? `FOR CRYPTOCURRENCY QUERIES (like this one), you MUST:
1. Create at least ONE simple, broad query that searches for general recent news (e.g., "Bitcoin news January 2026" or "BTC cryptocurrency news last week")
2. Search for both the symbol (e.g., BTC) AND the full name (e.g., Bitcoin) - use both terms in queries
3. Include queries about:
   - General recent news and developments (start broad, then narrow)
   - PRICE MILESTONES: crashes, all-time highs, liquidity events (e.g., "Bitcoin crash January 2026" or "BTC all-time high why")
   - Protocol upgrades and technical developments
   - Institutional adoption and major announcements
   - Regulatory news and government actions
   - Exchange listings and trading volume
   - Security incidents (confirmed hacks, exploits)
4. Use date ranges like "January 2026" or "last week" instead of restrictive "last 7 days" quotes
5. Don't be too restrictive - include general news queries to catch all developments` : ''}

${isETFQuery ? `FOR ETF QUERIES (like this one), you MUST:
1. Create at least ONE simple, broad query that searches for general recent news (e.g., "SPY January 2026" or "S&P 500 ETF last week")
2. Include queries about:
   - General recent news and developments (start broad, then narrow)
   - PRICE MILESTONES: crashes, all-time highs, major drawdowns (e.g., "S&P 500 drop January 2026 why")
   - Index composition changes, flows, underlying asset developments
3. Use date ranges like "January 2026" or "last week" instead of restrictive "last 7 days" quotes
4. Don't be too restrictive - include general news queries to catch all developments` : ''}

IMPORTANT: When researching companies, look for:
- Strategic implications and directional indicators (where is the company heading?)
- What events reveal about company power/position (not just what happened, but what it means)
- Competitive dynamics and market positioning (who has leverage and why?)
- Regulatory/political impacts that show company strength (e.g., if a company can require upfront payments despite regulatory pressure, that shows power)

CRITICAL: Capture as many different stories, events, and developments as possible. Generate queries that will uncover multiple significant events, regulatory changes, strategic moves, competitive dynamics, market shifts, price milestones (crashes, all-time highs), earnings surprises, product launches, partnerships, regulatory battles, etc. The goal is to gather a rich collection of stories, not just focus on one angle.

PRICE MILESTONES: For any asset (stocks, ETFs, crypto, commodities), include at least one query about significant price moves (crashes, ATHs) when relevant. These help investors make decisions.

Focus on what will impact the company's direction and reveal its competitive position, not just news events.

<prompt>${query}</prompt>\n\n${
      learnings
        ? `Here are some learnings from previous research, use them to generate more specific queries: ${learnings.join(
            '\n',
          )}`
        : ''
    }`,
    schema: z.object({
      queries: z
        .array(
          z.object({
            query: z.string().describe('The SERP query'),
            researchGoal: z
              .string()
              .describe(
                'First talk about the goal of the research that this query is meant to accomplish, then go deeper into how to advance the research once the results are found, mention additional research directions. Be as specific as possible, especially for additional research directions.',
              ),
          }),
        )
        .describe(`List of SERP queries, max of ${numQueries}`),
    }),
  });
  log('debug', `Created ${res.object.queries.length} queries`, res.object.queries);

  return res.object.queries.slice(0, numQueries);
}

// Triage titles to select all relevant and important articles before scraping
export async function triageTitles({
  query,
  results,
  researchGoal,
}: {
  query: string;
  results: Array<{ url: string; title?: string; description?: string; snippet?: string }>;
  researchGoal?: string;
}): Promise<string[]> {
  if (results.length === 0) return [];

  const titlesList = results
    .map((r, i) => {
      const title = r.title || 'No title';
      const desc = r.description || r.snippet || 'No description';
      return `${i + 1}. Title: ${title}\n   Description: ${desc}\n   URL: ${r.url}`;
    })
    .join('\n\n');

  // Check source quality from URLs
  const tier1Indicators = ['reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'sec.gov', 'eia.gov', 'opec.org', 'company filings', '.gov'];
  const tier3Indicators = ['marketminute', 'financialcontent', 'brightpath', 'consulting', 'outlook', 'aggregator'];
  
  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Given the research query "${query}"${researchGoal ? `\n\nResearch Goal: ${researchGoal}` : ''}, analyze these article titles and descriptions and select ALL articles that are relevant and important. DO NOT limit by count - select all that meet the criteria.

CRITICAL SELECTION CRITERIA (select ALL articles that meet these):
1. SOURCE QUALITY (MOST IMPORTANT):
   - STRONGLY PREFER Tier 1 sources: Reuters, Bloomberg, Financial Times, WSJ, SEC filings, EIA data, OPEC statements
   - REJECT Tier 3 sources: consulting blogs (BrightPath), aggregators (MarketMinute, FinancialContent), generic outlooks
   - If you see URLs with "marketminute", "financialcontent", "brightpath", "consulting" - REJECT them (not relevant/important)
   - Only include Tier 3 if they contain critical information not available elsewhere

2. RECENCY:
   - Prioritize articles about events in the LAST 7 DAYS
   - IMPORTANT: The search queries already filtered for recent content (last 7 days). If an article doesn't have an explicit date, assume it's recent and include it if it's relevant.
   - Only REJECT articles if you can CLEARLY see a date that's outside the 7-day window (e.g., "2017", "2024" when we're in 2026, or explicit dates more than 7 days ago)
   - REJECT articles that are just "2025 outlook" or "2030 projections" without recent news
   - If date is ambiguous or missing, err on the side of inclusion if the article is relevant and from a Tier 1 source

3. CONTENT RELEVANCE AND IMPORTANCE:
   - Select articles with strategic implications and directional indicators
   - Select articles with shocking/first-time developments ("for the first time ever", "unprecedented", "historic reversal")
   - Select articles that reveal company power/position (not just news events)
   - Select articles with competitive dynamics and market positioning insights
   - Select articles with regulatory/political impacts that show company strength
   - Select articles about PRICE MILESTONES: crashes, all-time highs, major drawdowns — these help investors make decisions (stocks, ETFs, crypto, commodities)
   - PREFER price-milestone articles that explain WHY (causes), WHAT happened before (context), and WHAT NEXT (implications)
   - REJECT articles that are clearly not relevant to the query
   - REJECT articles that are not important (trivial news, noise)

4. FOR COMMODITIES/ENERGY:
   - Select articles with actual price data, supply/demand numbers, inventory levels
   - Select articles with OPEC statements, EIA data, actual market fundamentals

IMPORTANT: Select ALL articles that are relevant and important. Do not limit by count. If 8 out of 10 are relevant, select all 8. Only reject articles that are clearly not relevant or not important.

Article Titles and Descriptions:
${titlesList}`,
    schema: z.object({
      selectedUrls: z.array(z.string()).describe('URLs of ALL relevant and important articles (no limit on count)'),
      reasoning: z.string().describe('Brief explanation of why these articles were selected and why others were rejected'),
    }),
  });

  log('info', `Triage: Selected ${res.object.selectedUrls.length} articles from ${results.length} results`);
  log('debug', `Triage reasoning: ${res.object.reasoning}`);

  return res.object.selectedUrls;
}

// Batched triage - processes all articles together with better deduplication
export async function triageTitlesBatched({
  query,
  results,
  researchGoals,
}: {
  query: string;
  results: Array<{ url: string; title?: string; description?: string; snippet?: string; publishedDate?: string }>;
  researchGoals: string[];
}): Promise<string[]> {
  if (results.length === 0) return [];

  // Deduplicate by URL first (in case same article appears multiple times)
  const urlMap = new Map<string, typeof results[0]>();
  for (const result of results) {
    if (!urlMap.has(result.url)) {
      urlMap.set(result.url, result);
    }
  }
  const uniqueResults = Array.from(urlMap.values());

  const researchGoalsText = researchGoals.length > 0 
    ? `\n\nResearch Goals:\n${researchGoals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')}`
    : '';

  // Batch processing: process articles in smaller groups to avoid timeouts
  const TRIAGE_BATCH_SIZE = 30; // Process 30 articles at a time for triage
  const allSelectedUrls: string[] = [];
  
  // If we have many articles, process in batches
  if (uniqueResults.length > TRIAGE_BATCH_SIZE) {
    log('info', `📦 Triage: Processing ${uniqueResults.length} articles in batches of ${TRIAGE_BATCH_SIZE}...`);
    const batches: typeof uniqueResults[] = [];
    for (let i = 0; i < uniqueResults.length; i += TRIAGE_BATCH_SIZE) {
      batches.push(uniqueResults.slice(i, i + TRIAGE_BATCH_SIZE));
    }
    
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      log('debug', `  Processing triage batch ${batchIdx + 1}/${batches.length} (${batch.length} articles)...`);
      
      const titlesList = batch
        .map((r, i) => {
          const title = r.title || 'No title';
          const desc = r.description || r.snippet || 'No description';
          const dateInfo = r.publishedDate ? `\n   Published Date: ${r.publishedDate}` : '';
          return `${i + 1}. Title: ${title}\n   Description: ${desc}\n   URL: ${r.url}${dateInfo}`;
        })
        .join('\n\n');
      
      const batchRes = await generateObject({
        model: getModel(),
        system: systemPrompt(),
        prompt: `Given the research query "${query}"${researchGoalsText}, analyze these article titles and descriptions and select ALL articles that are relevant and important. DO NOT limit by count - select all that meet the criteria.

CRITICAL: These articles come from MULTIPLE search queries. You may see the same story covered by different sources. Focus on selecting ALL relevant articles - we will deduplicate and pick best sources later.

CRITICAL SELECTION CRITERIA (select ALL articles that meet these):
1. SOURCE QUALITY (MOST IMPORTANT):
   - STRONGLY PREFER Tier 1 sources: Reuters, Bloomberg, Financial Times, WSJ, SEC filings, EIA data, OPEC statements
   - REJECT Tier 3 sources: consulting blogs (BrightPath), aggregators (MarketMinute, FinancialContent), generic outlooks
   - If you see URLs with "marketminute", "financialcontent", "brightpath", "consulting" - REJECT them (not relevant/important)
   - Only include Tier 3 if they contain critical information not available elsewhere

2. RECENCY:
   - Prioritize articles about events in the LAST 7 DAYS
   - IMPORTANT: The search queries already filtered for recent content (last 7 days). If an article doesn't have an explicit date, assume it's recent and include it if it's relevant.
   - Only REJECT articles if you can CLEARLY see a date that's outside the 7-day window (e.g., "2017", "2024" when we're in 2026, or explicit dates more than 7 days ago)
   - REJECT articles that are just "2025 outlook" or "2030 projections" without recent news
   - If date is ambiguous or missing, err on the side of inclusion if the article is relevant and from a Tier 1 source

3. CONTENT RELEVANCE AND IMPORTANCE:
   - Select articles with strategic implications and directional indicators
   - Select articles with shocking/first-time developments ("for the first time ever", "unprecedented", "historic reversal")
   - Select articles that reveal company power/position (not just news events)
   - Select articles with competitive dynamics and market positioning insights
   - Select articles with regulatory/political impacts that show company strength
   - Select articles about PRICE MILESTONES: crashes, all-time highs, major drawdowns — these help investors make decisions (stocks, ETFs, crypto, commodities)
   - PREFER price-milestone articles that explain WHY (causes), WHAT happened before (context), and WHAT NEXT (implications)
   - REJECT articles that are clearly not relevant to the query
   - REJECT articles that are not important (trivial news, noise)

4. FOR COMMODITIES/ENERGY:
   - Select articles with actual price data, supply/demand numbers, inventory levels
   - Select articles with OPEC statements, EIA data, actual market fundamentals

IMPORTANT: Select ALL articles that are relevant and important. Do not limit by count. If 8 out of 10 are relevant, select all 8. Only reject articles that are clearly not relevant or not important.

Article Titles and Descriptions (${batch.length} articles):
${titlesList}`,
        schema: z.object({
          selectedUrls: z.array(z.string()).describe('URLs of ALL relevant and important articles (no limit on count)'),
          reasoning: z.string().describe('Brief explanation of why these articles were selected and why others were rejected'),
        }),
      });
      
      allSelectedUrls.push(...batchRes.object.selectedUrls);
      log('debug', `    ✅ Batch ${batchIdx + 1} complete: ${batchRes.object.selectedUrls.length} selected`);
    }
    
    // Deduplicate URLs (in case same URL selected in multiple batches)
    const uniqueSelectedUrls = Array.from(new Set(allSelectedUrls));
    log('info', `✅ Triage complete: ${uniqueSelectedUrls.length} unique articles selected from ${uniqueResults.length} total (${results.length} before dedup)`);
    
    return uniqueSelectedUrls;
  } else {
    // Small batch - process all at once (original behavior)
    const titlesList = uniqueResults
      .map((r, i) => {
        const title = r.title || 'No title';
        const desc = r.description || r.snippet || 'No description';
        const dateInfo = r.publishedDate ? `\n   Published Date: ${r.publishedDate}` : '';
        return `${i + 1}. Title: ${title}\n   Description: ${desc}\n   URL: ${r.url}${dateInfo}`;
      })
      .join('\n\n');

    const res = await generateObject({
      model: getModel(),
      system: systemPrompt(),
      prompt: `Given the research query "${query}"${researchGoalsText}, analyze these article titles and descriptions and select ALL articles that are relevant and important. DO NOT limit by count - select all that meet the criteria.

CRITICAL: These articles come from MULTIPLE search queries. You may see the same story covered by different sources. Focus on selecting ALL relevant articles - we will deduplicate and pick best sources later.

CRITICAL SELECTION CRITERIA (select ALL articles that meet these):
1. SOURCE QUALITY (MOST IMPORTANT):
   - STRONGLY PREFER Tier 1 sources: Reuters, Bloomberg, Financial Times, WSJ, SEC filings, EIA data, OPEC statements
   - REJECT Tier 3 sources: consulting blogs (BrightPath), aggregators (MarketMinute, FinancialContent), generic outlooks
   - If you see URLs with "marketminute", "financialcontent", "brightpath", "consulting" - REJECT them (not relevant/important)
   - Only include Tier 3 if they contain critical information not available elsewhere

2. RECENCY:
   - Prioritize articles about events in the LAST 7 DAYS
   - IMPORTANT: The search queries already filtered for recent content (last 7 days). If an article doesn't have an explicit date, assume it's recent and include it if it's relevant.
   - Only REJECT articles if you can CLEARLY see a date that's outside the 7-day window (e.g., "2017", "2024" when we're in 2026, or explicit dates more than 7 days ago)
   - REJECT articles that are just "2025 outlook" or "2030 projections" without recent news
   - If date is ambiguous or missing, err on the side of inclusion if the article is relevant and from a Tier 1 source

3. CONTENT RELEVANCE AND IMPORTANCE:
   - Select articles with strategic implications and directional indicators
   - Select articles with shocking/first-time developments ("for the first time ever", "unprecedented", "historic reversal")
   - Select articles that reveal company power/position (not just news events)
   - Select articles with competitive dynamics and market positioning insights
   - Select articles with regulatory/political impacts that show company strength
   - Select articles about PRICE MILESTONES: crashes, all-time highs, major drawdowns — these help investors make decisions (stocks, ETFs, crypto, commodities)
   - PREFER price-milestone articles that explain WHY (causes), WHAT happened before (context), and WHAT NEXT (implications)
   - REJECT articles that are clearly not relevant to the query
   - REJECT articles that are not important (trivial news, noise)

4. FOR COMMODITIES/ENERGY:
   - Select articles with actual price data, supply/demand numbers, inventory levels
   - Select articles with OPEC statements, EIA data, actual market fundamentals

IMPORTANT: Select ALL articles that are relevant and important. Do not limit by count. If 8 out of 10 are relevant, select all 8. Only reject articles that are clearly not relevant or not important.

Article Titles and Descriptions (${uniqueResults.length} unique articles):
${titlesList}`,
      schema: z.object({
        selectedUrls: z.array(z.string()).describe('URLs of ALL relevant and important articles (no limit on count)'),
        reasoning: z.string().describe('Brief explanation of why these articles were selected and why others were rejected'),
      }),
    });

    log('info', `Batched Triage: Selected ${res.object.selectedUrls.length} articles from ${uniqueResults.length} unique results (${results.length} total before dedup)`);
    log('debug', `Triage reasoning: ${res.object.reasoning}`);

    return res.object.selectedUrls;
  }
}

// Smart filter: Determine which articles need scraping vs metadata-only, group duplicates
async function filterScrapeNeeds({
  query,
  triagedResults,
  researchGoal,
}: {
  query: string;
  triagedResults: Array<{ url: string; title?: string; description?: string; snippet?: string }>;
  researchGoal?: string;
}): Promise<{
  toScrape: Array<{ url: string; reason: string }>;
  metadataOnly: Array<{ url: string; title?: string; description?: string; reason: string }>;
}> {
  if (triagedResults.length === 0) {
    return { toScrape: [], metadataOnly: [] };
  }

  const articlesList = triagedResults
    .map((r, i) => {
      const title = r.title || 'No title';
      const desc = r.description || r.snippet || 'No description';
      // Extract domain for source quality
      let domain = '';
      try {
        domain = new URL(r.url).hostname;
      } catch {
        domain = r.url;
      }
      return `${i + 1}. Title: ${title}\n   Description: ${desc}\n   URL: ${r.url}\n   Domain: ${domain}`;
    })
    .join('\n\n');

  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Given the research query "${query}"${researchGoal ? `\n\nResearch Goal: ${researchGoal}` : ''}, analyze these triaged articles and decide:

1. GROUP SIMILAR STORIES: Group articles that cover the same/similar story/event
2. PICK BEST SOURCE: For each group, pick the best source (prioritize Tier 1: Reuters, Bloomberg, FT, WSJ, SEC, EIA, OPEC)
3. DETERMINE SCRAPE NEED: For each article, decide if:
   - NEEDS SCRAPING: Missing critical data (specific prices, numbers, dates, metrics), company filings, detailed analysis, strategic implications not in title
   - METADATA SUFFICIENT: Title/description has all key info (price in headline, simple news event, basic announcement)

CRITICAL DECISION FACTORS:
- NEEDS SCRAPING: Price data missing, company filings, detailed metrics, earnings numbers, regulatory details, strategic analysis
- METADATA SUFFICIENT: Price in headline/description, simple event announcement, basic news item with key facts visible
- FOR DUPLICATES: Only scrape the BEST source (Tier 1 > Tier 2 > Tier 3), use others for metadata only

Articles:
${articlesList}`,
    schema: z.object({
      groups: z
        .array(
          z.object({
            storyGroup: z.string().describe('Brief description of the story/event this group covers'),
            articles: z
              .array(
                z.object({
                  url: z.string(),
                  needsScraping: z
                    .boolean()
                    .describe('True if article needs full scraping, false if metadata (title/description) is sufficient'),
                  reason: z.string().describe('Why this article needs/doesnt need scraping'),
                  isBestSource: z
                    .boolean()
                    .describe('True if this is the best source in the group (for duplicates, only one should be true)'),
                }),
              )
              .describe('Articles in this group covering the same/similar story'),
          }),
        )
        .describe('Groups of similar articles'),
    }),
  });

  const toScrape: Array<{ url: string; reason: string }> = [];
  const metadataOnly: Array<{ url: string; title?: string; description?: string; reason: string }> = [];

  for (const group of res.object.groups) {
    // For each group, only scrape the best source if needed
    const bestSource = group.articles.find(a => a.isBestSource);
    const otherSources = group.articles.filter(a => !a.isBestSource);

    // Handle best source
    if (bestSource) {
      const article = triagedResults.find(r => r.url === bestSource.url);
      if (bestSource.needsScraping) {
        toScrape.push({ url: bestSource.url, reason: bestSource.reason });
      } else {
        metadataOnly.push({
          url: bestSource.url,
          title: article?.title,
          description: article?.description || article?.snippet,
          reason: bestSource.reason,
        });
      }
    }

    // Other sources in group - use metadata only (duplicates)
    for (const otherSource of otherSources) {
      const article = triagedResults.find(r => r.url === otherSource.url);
      metadataOnly.push({
        url: otherSource.url,
        title: article?.title,
        description: article?.description || article?.snippet,
        reason: `Duplicate story - using metadata only. Best source scraped instead. ${otherSource.reason}`,
      });
    }
  }

  log('info', `Smart Filter: ${toScrape.length} to scrape, ${metadataOnly.length} metadata-only`);
  if (toScrape.length > 0) {
    log('debug', `  Scraping: ${toScrape.map(s => s.url.split('/').pop()).join(', ')}`);
  }
  if (metadataOnly.length > 0) {
    log('debug', `  Metadata-only: ${metadataOnly.map(m => m.url.split('/').pop()).join(', ')}`);
  }

  return { toScrape, metadataOnly };
}

// Batched filter - processes all articles together with better story deduplication across queries
export async function filterScrapeNeedsBatched({
  query,
  triagedResults,
  researchGoals,
}: {
  query: string;
  triagedResults: Array<{ url: string; title?: string; description?: string; snippet?: string }>;
  researchGoals: string[];
}): Promise<{
  toScrape: Array<{ url: string; reason: string }>;
  metadataOnly: Array<{ url: string; title?: string; description?: string; reason: string }>;
}> {
  if (triagedResults.length === 0) {
    return { toScrape: [], metadataOnly: [] };
  }

  const articlesList = triagedResults
    .map((r, i) => {
      const title = r.title || 'No title';
      const desc = r.description || r.snippet || 'No description';
      // Extract domain for source quality
      let domain = '';
      try {
        domain = new URL(r.url).hostname;
      } catch {
        domain = r.url;
      }
      return `${i + 1}. Title: ${title}\n   Description: ${desc}\n   URL: ${r.url}\n   Domain: ${domain}`;
    })
    .join('\n\n');

  const researchGoalsText = researchGoals.length > 0 
    ? `\n\nResearch Goals:\n${researchGoals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')}`
    : '';

  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Given the research query "${query}"${researchGoalsText}, analyze these triaged articles and decide:

CRITICAL: These articles come from MULTIPLE search queries. You may see the SAME story covered by different sources from different queries. You MUST:
1. GROUP SIMILAR STORIES: Group articles that cover the same/similar story/event (even if from different queries)
2. PICK BEST SOURCE GLOBALLY: For each group, pick the SINGLE BEST source across ALL queries (prioritize Tier 1: Reuters, Bloomberg, FT, WSJ, SEC, EIA, OPEC)
3. DETERMINE SCRAPE NEED: For each article, decide if:
   - NEEDS SCRAPING: Missing critical data (specific prices, numbers, dates, metrics), company filings, detailed analysis, strategic implications not in title
   - METADATA SUFFICIENT: Title/description has all key info (price in headline, simple news event, basic announcement)

CRITICAL DECISION FACTORS:
- NEEDS SCRAPING: Price data missing, company filings, detailed metrics, earnings numbers, regulatory details, strategic analysis
- METADATA SUFFICIENT: Price in headline/description, simple event announcement, basic news item with key facts visible
- FOR DUPLICATES: Only scrape the SINGLE BEST source globally (Tier 1 > Tier 2 > Tier 3), use ALL others for metadata only
- IMPORTANT: If the same story appears in multiple queries, pick the best source ONCE and mark all others as duplicates

Articles (${triagedResults.length} articles from multiple queries):
${articlesList}`,
    schema: z.object({
      groups: z
        .array(
          z.object({
            storyGroup: z.string().describe('Brief description of the story/event this group covers'),
            articles: z
              .array(
                z.object({
                  url: z.string(),
                  needsScraping: z
                    .boolean()
                    .describe('True if article needs full scraping, false if metadata (title/description) is sufficient'),
                  reason: z.string().describe('Why this article needs/doesnt need scraping'),
                  isBestSource: z
                    .boolean()
                    .describe('True if this is the SINGLE best source globally for this story (only one per group should be true)'),
                }),
              )
              .describe('Articles in this group covering the same/similar story'),
          }),
        )
        .describe('Groups of similar articles (deduplicated across all queries)'),
    }),
  });

  const toScrape: Array<{ url: string; reason: string }> = [];
  const metadataOnly: Array<{ url: string; title?: string; description?: string; reason: string }> = [];

  for (const group of res.object.groups) {
    // For each group, only scrape the best source if needed
    const bestSource = group.articles.find(a => a.isBestSource);
    const otherSources = group.articles.filter(a => !a.isBestSource);

    // Handle best source
    if (bestSource) {
      const article = triagedResults.find(r => r.url === bestSource.url);
      if (bestSource.needsScraping) {
        toScrape.push({ url: bestSource.url, reason: bestSource.reason });
      } else {
        metadataOnly.push({
          url: bestSource.url,
          title: article?.title,
          description: article?.description || article?.snippet,
          reason: bestSource.reason,
        });
      }
    }

    // Other sources in group - use metadata only (duplicates)
    for (const otherSource of otherSources) {
      const article = triagedResults.find(r => r.url === otherSource.url);
      metadataOnly.push({
        url: otherSource.url,
        title: article?.title,
        description: article?.description || article?.snippet,
        reason: `Duplicate story - using metadata only. Best source scraped instead. ${otherSource.reason}`,
      });
    }
  }

  log('info', `Batched Smart Filter: ${toScrape.length} to scrape, ${metadataOnly.length} metadata-only`);
  if (toScrape.length > 0) {
    log('debug', `  Scraping: ${toScrape.map(s => s.url.split('/').pop()).join(', ')}`);
  }
  if (metadataOnly.length > 0) {
    log('debug', `  Metadata-only: ${metadataOnly.map(m => m.url.split('/').pop()).join(', ')}`);
  }

  return { toScrape, metadataOnly };
}

export async function processSerpResult({
  query,
  result,
  numLearnings = 3,
  numFollowUpQuestions = 3,
}: {
  query: string;
  result: SearchResponse;
  numLearnings?: number;
  numFollowUpQuestions?: number;
}) {
  const contents = compact(result.data.map(item => item.markdown)).map(content =>
    trimPrompt(content, 25_000),
  );
  log('debug', `Ran ${query}, found ${contents.length} contents`);

  const isCommodityQuery = /\b(oil|energy|gas|crude|commodit|natural gas|LNG|petroleum|OPEC|WTI|Brent)\b/i.test(query);
  const isCompanyQuery = /\b(NVIDIA|AAPL|MSFT|GOOGL|JPM|XOM|Exxon|company|earnings|stock)\b/i.test(query);
  
  // Batch processing: process articles in smaller groups to avoid timeouts
  const BATCH_SIZE = 8; // Process 8 articles at a time
  const allBatchLearnings: string[] = [];
  const allFollowUpQuestions: string[] = [];
  
  // If we have many articles, process in batches
  if (contents.length > BATCH_SIZE) {
    log('info', `📦 Processing ${contents.length} articles in batches of ${BATCH_SIZE}...`);
    const batches: string[][] = [];
    for (let i = 0; i < contents.length; i += BATCH_SIZE) {
      batches.push(contents.slice(i, i + BATCH_SIZE));
    }
    
    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];
      log('debug', `  Processing batch ${batchIdx + 1}/${batches.length} (${batch.length} articles)...`);
      
      const batchRes = await generateObject({
        model: getModel(),
        system: systemPrompt(),
        prompt: trimPrompt(
          `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates.

IMPORTANT NUMBERS: Always capture and preserve specific figures — prices (e.g., "$78,000"), percentage changes (e.g., "-15%"), dates, earnings/revenue numbers, guidance, inventory levels, rate decisions. These are critical for investor cards. Never summarize as "prices fell" — extract the actual numbers. Also capture benchmark/context when present (e.g., "largest drop since March", "beat estimates by 8%", "unusually volatile") so readers understand if a number is big or small.

CRITICAL REQUIREMENTS:
1. TIME FRAME: Only extract learnings about events/developments from the LAST 7 DAYS. If content discusses long-term trends (2025 outlooks, 2030 projections) without a specific recent event, flag it as "LONG-TERM TREND" or "CONTEXT", not as a recent change.

2. SIGNAL vs NOISE: Distinguish between:
   - SIGNAL: Actual recent change that affects value/risk (published in last 7 days)
   - NOISE: Ongoing trends, background context, speculation
   - Flag each learning type: "RECENT CHANGE" vs "LONG-TERM TREND" vs "CONTEXT"

3. ${isCommodityQuery ? `FOR COMMODITIES/ENERGY: You MUST capture:
   - Current price levels and recent movements (actual numbers, not just "prices rose")
   - Supply vs demand balance (is supply exceeding demand?)
   - Inventory levels (rising/falling?)
   - OPEC/producer behavior (what are they doing?)
   - Price reactions (why are prices reacting or NOT reacting?)` : ''}

4. ${isCompanyQuery ? `FOR COMPANIES: You MUST capture:
   - Holdings-level impact (what does this mean for holders of this company?)
   - Bullish/neutral/bearish implications
   - Near-term vs long-term impact
   - Risk implications (does this raise or lower risk?)` : ''}

5. WHAT DIDN'T CHANGE: For each major learning, also note:
   - What remains stable (what didn't change)
   - Core fundamentals that are intact
   - Is this a turning point or just evolution?

6. ECONOMIC FUNDAMENTALS (prioritize these over tech buzzwords):
   - Margins, cash flow, capital returns
   - Cost curves, break-even prices
   - Capital allocation decisions
   - Dividend sustainability
   - Real economic impact on business
   - AVOID over-weighting: AI, IoT, digitalization (unless directly impacts economics)

IMPORTANT: When extracting learnings about companies, focus on:
- Strategic implications and what events reveal about company power/position
- Directional indicators (where is the company heading?)
- Competitive dynamics and market leverage (e.g., if a company can require upfront payments despite regulatory pressure, that shows power)
- What the events tell us about the company's direction and competitive position, not just what happened

The learnings will be used to research the topic further.\n\n<contents>${batch
            .map(content => `<content>\n${content}\n</content>`)
            .join('\n')}</contents>`,
        ),
        schema: z.object({
          learnings: z.array(z.string()).describe(`List of learnings, max of ${numLearnings}. Each should be prefixed with [RECENT CHANGE], [LONG-TERM TREND], or [CONTEXT]`),
          followUpQuestions: z
            .array(z.string())
            .describe(
              `List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`,
            ),
        }),
      });
      
      allBatchLearnings.push(...batchRes.object.learnings);
      allFollowUpQuestions.push(...batchRes.object.followUpQuestions);
      log('debug', `    ✅ Batch ${batchIdx + 1} complete: ${batchRes.object.learnings.length} learnings`);
    }
    
    // Deduplicate learnings (keep unique ones)
    const uniqueLearnings = Array.from(new Set(allBatchLearnings));
    const uniqueFollowUpQuestions = Array.from(new Set(allFollowUpQuestions));
    
    log('info', `✅ Processed all batches: ${uniqueLearnings.length} unique learnings from ${contents.length} articles`);
    
    return {
      learnings: uniqueLearnings,
      followUpQuestions: uniqueFollowUpQuestions.slice(0, numFollowUpQuestions),
    };
  } else {
    // Small batch - process all at once (original behavior)
    const res = await generateObject({
      model: getModel(),
      system: systemPrompt(),
      prompt: trimPrompt(
        `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates.

IMPORTANT NUMBERS: Always capture and preserve specific figures — prices (e.g., "$78,000"), percentage changes (e.g., "-15%"), dates, earnings/revenue numbers, guidance, inventory levels, rate decisions. These are critical for investor cards. Never summarize as "prices fell" — extract the actual numbers. Also capture benchmark/context when present (e.g., "largest drop since March", "beat estimates by 8%", "unusually volatile") so readers understand if a number is big or small.

CRITICAL REQUIREMENTS:
1. TIME FRAME: Only extract learnings about events/developments from the LAST 7 DAYS. If content discusses long-term trends (2025 outlooks, 2030 projections) without a specific recent event, flag it as "LONG-TERM TREND" or "CONTEXT", not as a recent change.

2. SIGNAL vs NOISE: Distinguish between:
   - SIGNAL: Actual recent change that affects value/risk (published in last 7 days)
   - NOISE: Ongoing trends, background context, speculation
   - Flag each learning type: "RECENT CHANGE" vs "LONG-TERM TREND" vs "CONTEXT"

3. ${isCommodityQuery ? `FOR COMMODITIES/ENERGY: You MUST capture:
   - Current price levels and recent movements (actual numbers, not just "prices rose")
   - Supply vs demand balance (is supply exceeding demand?)
   - Inventory levels (rising/falling?)
   - OPEC/producer behavior (what are they doing?)
   - Price reactions (why are prices reacting or NOT reacting?)` : ''}

4. ${isCompanyQuery ? `FOR COMPANIES: You MUST capture:
   - Holdings-level impact (what does this mean for holders of this company?)
   - Bullish/neutral/bearish implications
   - Near-term vs long-term impact
   - Risk implications (does this raise or lower risk?)` : ''}

5. WHAT DIDN'T CHANGE: For each major learning, also note:
   - What remains stable (what didn't change)
   - Core fundamentals that are intact
   - Is this a turning point or just evolution?

6. ECONOMIC FUNDAMENTALS (prioritize these over tech buzzwords):
   - Margins, cash flow, capital returns
   - Cost curves, break-even prices
   - Capital allocation decisions
   - Dividend sustainability
   - Real economic impact on business
   - AVOID over-weighting: AI, IoT, digitalization (unless directly impacts economics)

IMPORTANT: When extracting learnings about companies, focus on:
- Strategic implications and what events reveal about company power/position
- Directional indicators (where is the company heading?)
- Competitive dynamics and market leverage (e.g., if a company can require upfront payments despite regulatory pressure, that shows power)
- What the events tell us about the company's direction and competitive position, not just what happened

The learnings will be used to research the topic further.\n\n<contents>${contents
        .map(content => `<content>\n${content}\n</content>`)
        .join('\n')}</contents>`,
      ),
      schema: z.object({
        learnings: z.array(z.string()).describe(`List of learnings, max of ${numLearnings}. Each should be prefixed with [RECENT CHANGE], [LONG-TERM TREND], or [CONTEXT]`),
        followUpQuestions: z
          .array(z.string())
          .describe(
            `List of follow-up questions to research the topic further, max of ${numFollowUpQuestions}`,
          ),
      }),
    });
    log('debug', `Created ${res.object.learnings.length} learnings`, res.object.learnings);

    return res.object;
  }
}

/** Detect macro category from card title (for tagging at pipeline time). */
function detectMacroFromTitle(title: string): string | undefined {
  const upper = title.toUpperCase();
  if ((upper.includes('FED') && !upper.includes('ETHEREUM')) || (upper.includes('ECB') && !upper.includes('ETHEREUM')) || upper.includes('CENTRAL BANK')) return 'Central Bank Policy';
  if (upper.includes('ECONOMIC DATA') || (upper.includes('GDP') && upper.includes('INFLATION'))) return 'Economic Data';
  if (upper.includes('CURRENCY') || (upper.includes('DOLLAR') && upper.includes('EXCHANGE'))) return 'Currency Moves';
  if (upper.includes('GEOPOLITICAL') || upper.includes('GEO-POLITICAL')) return 'Geopolitical';
  return undefined;
}

export type WriteFinalReportResult = {
  reportMarkdown: string;
  cardMetadata: Array<{ ticker?: string; macro?: string }>;
};

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
  skipRewrite = false,
  holdings,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
  skipRewrite?: boolean;
  holdings?: string[]; // Optional: explicit list of holdings that were researched
}): Promise<WriteFinalReportResult> {
  const learningsString = learnings
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  // Step 1: Generate potential cards from learnings
  log('info', '📝 Generating potential story cards...');
  const cardsRes = await generateObject({
    model: getModel(),
    system: reportStylePrompt(),
    prompt: trimPrompt(
      `Analyze the learnings below and identify distinct stories/developments that should become cards.

For each potential card, provide:
1. A title: ONE short, message-style sentence (9-14 words) that explains why this story is interesting
2. Which learnings it covers
3. Why it matters (impact/importance)
4. Whether it provides actionable value

TITLE REQUIREMENTS (MAGIC FORMULA - MANDATORY):
- Follow this formula: What they did + Why they did it + Why it matters
- MUST be 9–14 words (no exceptions)
- One sentence only
- Casual, conversational tone (like a text message)
- Not a headline, not a summary

TITLE STYLE RULES:
- No jargon or acronyms
- No corporate or analyst language
- Verbs over abstract nouns
- Calm, confident, human

CRITICAL: The title MUST be a complete sentence that tells a story, not just a phrase. Examples:
- GOOD: "Netflix switched to all-cash offer to speed up the deal and avoid regulatory delays" (14 words) ✓
- BAD: "Netflix Update" (2 words) ✗
- BAD: "Merger Deal" (2 words) ✗

GROUPING — CRITICAL: One storyline per holding when possible
- For the SAME holding (e.g., BTC, AAPL, NVDA), prefer ONE card that weaves together all related developments into a single storyline.
- Multiple developments about Bitcoin (crash + regulatory + ecosystem) should be ONE card, not three. Use transitions: "Meanwhile...", "Separately...", "Also this week..."
- Only create separate cards for the same holding when stories are genuinely unrelated (e.g., earnings vs. a completely separate lawsuit in another jurisdiction).
- Fewer, richer cards beat many fragmented ones. Each holding ideally gets 1 consolidated card.

CRITICAL: Only include cards that:
- Provide actionable insights (help make smarter decisions)
- Are impactful and newsworthy
- Have clear context and implications
- Are NOT empty drama - must have real value
- Have concrete numbers — prices, percentages, dates, earnings figures. Stories without key numbers are weak.
- Include benchmark context for numbers when possible — how big/small, vs expectations, vs prior period. Readers need to know "is that good or bad?"

PRICE MILESTONES (crashes, all-time highs): These are important for investors. When identifying a price-milestone story (crash, ATH, major drawdown), ensure the learnings provide: (1) WHY it happened — causes, catalysts; (2) WHAT happened before — context; (3) WHAT NEXT — implications; (4) THE NUMBERS — actual prices, % change, dates. Prefer learnings that have this full narrative and data over bare headlines.

<prompt>${prompt}</prompt>

<learnings>
${learningsString}
</learnings>`,
    ),
    schema: z.object({
      potentialCards: z.array(
        z.object({
          title: z.string().describe('Card title: ONE short, message-style sentence (9-14 words) following the magic formula: what they did + why they did it + why it matters'),
          relatedLearnings: z.array(z.string()).describe('Which learnings this card covers'),
          whyItMatters: z.string().describe('Why this story is important and impactful'),
          actionableValue: z.string().describe('What actionable insights this provides'),
          shouldInclude: z.boolean().describe('Whether this card should be included in the final report'),
        })
      ).describe('List of potential story cards'),
    }),
  });

  // Use provided holdings if available, otherwise try to extract from learnings
  let finalHoldings: string[] = [];
  
  if (holdings && holdings.length > 0) {
    // Use explicitly provided holdings (most reliable)
    finalHoldings = holdings.map(h => h.toUpperCase().trim()).sort();
    log('info', `📊 Using provided holdings: ${finalHoldings.join(', ')}`);
  } else {
    // Fallback: Try to extract from learnings (less reliable, but better than nothing)
    const holdingsSet = new Set<string>();
    const tickerPattern = /(?:^|[\s$\(,])([A-Z0-9]{1,5})(?=[\s\)\.,;:]|$)/g;
    const commonWords = new Set([
      'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 
      'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO',
      'BOY', 'DID', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'HAD', 'WITH', 'THIS', 'WEEK', 'THAT', 'FROM',
      'INTO', 'ONLY', 'OVER', 'UNDER', 'AFTER', 'BEFORE', 'ABOUT', 'ABOVE', 'BELOW', 'BETWEEN', 'AMONG',
      'STOCK', 'PRICE', 'SHARES', 'MARKET', 'TRADING', 'EARNINGS', 'REVENUE', 'GROWTH', 'SALES', 'PROFIT',
      'RECENT', 'CHANGE', 'CONTEXT', 'TREND', 'LONG', 'TERM', 'SHORT', 'TERM', 'METADATA'
    ]);
    
    // Also check for company names that map to tickers
    const companyNameMap: Record<string, string> = {
      'BLACKBERRY': 'BB',
      'LIGHTSPEED': 'LSPD',
      'NETFLIX': 'NFLX',
      'APPLE': 'AAPL',
      'NVIDIA': 'NVDA',
      'TESLA': 'TSLA',
      'MICROSOFT': 'MSFT',
      'GOOGLE': 'GOOGL',
      'AMAZON': 'AMZN',
    };
    
    for (const learning of learnings) {
      const upperLearning = learning.toUpperCase();
      
      // Check for company names first
      for (const [companyName, ticker] of Object.entries(companyNameMap)) {
        if (upperLearning.includes(companyName)) {
          holdingsSet.add(ticker);
        }
      }
      
      // Then check for ticker patterns
      let match;
      while ((match = tickerPattern.exec(upperLearning)) !== null) {
        const symbol = match[1];
        if (symbol.length >= 2 && 
            symbol.length <= 5 && 
            /[A-Z]/.test(symbol) && 
            !commonWords.has(symbol)) {
          holdingsSet.add(symbol);
        }
      }
    }
    finalHoldings = Array.from(holdingsSet).sort();
    
    if (finalHoldings.length > 0) {
      log('info', `📊 Extracted ${finalHoldings.length} holdings from learnings: ${finalHoldings.join(', ')}`);
    }
  }
  
  // Map cards to their primary holdings (extract ticker from title/content)
  const cardHoldings = cardsRes.object.potentialCards.map((card, i) => {
    const cardText = `${card.title.toUpperCase()} ${card.relatedLearnings.join(' ').toUpperCase()}`;
    const cardTickers: string[] = [];
    
    // Check for company names first
    const companyNameMap: Record<string, string> = {
      'BLACKBERRY': 'BB',
      'LIGHTSPEED': 'LSPD',
      'NETFLIX': 'NFLX',
      'APPLE': 'AAPL',
      'NVIDIA': 'NVDA',
      'TESLA': 'TSLA',
      'MICROSOFT': 'MSFT',
      'GOOGLE': 'GOOGL',
      'AMAZON': 'AMZN',
    };
    
    for (const [companyName, ticker] of Object.entries(companyNameMap)) {
      if (cardText.includes(companyName) && finalHoldings.includes(ticker)) {
        cardTickers.push(ticker);
      }
    }
    
    // Then check for ticker symbols
    let match;
    const tickerRegex = /\b([A-Z]{2,5})\b/g;
    while ((match = tickerRegex.exec(cardText)) !== null) {
      const symbol = match[1];
      if (finalHoldings.includes(symbol)) {
        cardTickers.push(symbol);
      }
    }
    
    return { cardIndex: i, tickers: [...new Set(cardTickers)] }; // Deduplicate
  });

  // Step 2: Self-feedback to select the best cards
  log('info', '🔍 Selecting best cards with self-feedback...');
  const holdingsList = finalHoldings.length > 0 ? `\n\nHOLDINGS COVERAGE REQUIREMENT:
- The following holdings were researched: ${finalHoldings.join(', ')}
- You MUST select AT LEAST ONE card for EACH holding listed above
- If a holding has multiple potential cards, select the BEST one for that holding
- This ensures every researched holding gets representation in the final report` : '';
  
  const selectedCardsRes = await generateObject({
    model: getModel(),
    system: reportStylePrompt(),
    prompt: trimPrompt(
      `Review the potential cards below and select the best ones for the final report.${holdingsList}

SELECTION CRITERIA (ALL must be true):
1. Provides actionable value - helps reader make smarter decisions
2. Is impactful and newsworthy - why it's in the news matters
3. Has clear context - can explain past drama/background
4. Has future implications - can discuss what might happen next
5. NOT empty drama - must have real, useful information
6. Leaves reader smarter - teaches something valuable

GROUPING — PREFER CONSOLIDATION:
- When multiple potential cards cover the SAME holding (e.g., 3 Bitcoin cards), select at most ONE — the best or most comprehensive one.
- Do NOT select 2–3 cards that all cover Bitcoin unless they tell genuinely separate stories (e.g., earnings vs. unrelated lawsuit). Prefer one consolidated card per holding.
- Fewer, richer cards with full storylines beat many fragmented cards.

PRICE MILESTONES (crashes, all-time highs): When choosing between cards about price moves, PREFER cards whose learnings explain WHY (causes), WHAT happened before (context), and WHAT NEXT (implications). Reject bare "X crashed" or "X hit ATH" without this full narrative — they have no value for investors.

EXCLUDE cards that:
- Are just noise or hype without substance
- Don't provide actionable insights
- Are too vague or generic
- Don't have clear impact or implications

IMPORTANT: Select ALL cards that meet the criteria above. Do not artificially limit the count. If 10 cards meet the criteria, select all 10.${finalHoldings.length > 0 ? ` Additionally, ensure at least one card per holding from: ${finalHoldings.join(', ')}` : ''}

<prompt>${prompt}</prompt>

<potentialCards>
${cardsRes.object.potentialCards.map((card, i) => {
  const cardTickers = cardHoldings.find(ch => ch.cardIndex === i)?.tickers || [];
  const tickerInfo = cardTickers.length > 0 ? ` [Covers: ${cardTickers.join(', ')}]` : '';
  return `
Card ${i + 1}:${tickerInfo}
Title: ${card.title}
Why It Matters: ${card.whyItMatters}
Actionable Value: ${card.actionableValue}
Related Learnings: ${card.relatedLearnings.join(', ')}
`;
}).join('\n')}
</potentialCards>`,
    ),
    schema: z.object({
      selectedCardIndices: z.array(z.number()).describe('Indices (0-based) of cards to include in final report'),
      reasoning: z.string().describe('Brief explanation of why these cards were selected and others excluded'),
    }),
  });

  // Filter to selected cards and build per-card metadata (ticker from pipeline)
  let selectedCards = selectedCardsRes.object.selectedCardIndices
    .map(idx => cardsRes.object.potentialCards[idx])
    .filter(card => card !== undefined);

  // Per-card metadata: ticker from cardHoldings (tagged from researched holdings)
  let selectedCardMetadata: Array<{ ticker?: string; macro?: string }> = selectedCardsRes.object.selectedCardIndices.map(
    (idx) => ({ ticker: cardHoldings[idx]?.tickers?.[0] })
  );

  // Ensure at least one card per holding
  if (finalHoldings.length > 0) {
    const selectedCardTickers = new Set<string>();
    const companyNameMap: Record<string, string> = {
      'BLACKBERRY': 'BB',
      'LIGHTSPEED': 'LSPD',
      'NETFLIX': 'NFLX',
      'APPLE': 'AAPL',
      'NVIDIA': 'NVDA',
      'TESLA': 'TSLA',
      'MICROSOFT': 'MSFT',
      'GOOGLE': 'GOOGL',
      'AMAZON': 'AMZN',
    };
    
    for (const card of selectedCards) {
      const cardText = `${card.title.toUpperCase()} ${card.relatedLearnings.join(' ').toUpperCase()}`;
      
      // Check for company names
      for (const [companyName, ticker] of Object.entries(companyNameMap)) {
        if (cardText.includes(companyName) && finalHoldings.includes(ticker)) {
          selectedCardTickers.add(ticker);
        }
      }
      
      // Check for ticker symbols
      for (const holding of finalHoldings) {
        if (cardText.includes(holding)) {
          selectedCardTickers.add(holding);
        }
      }
    }

    // Find missing holdings
    const missingHoldings = finalHoldings.filter(h => !selectedCardTickers.has(h));
    
    if (missingHoldings.length > 0) {
      log('info', `⚠️  Missing cards for holdings: ${missingHoldings.join(', ')}. Adding cards to ensure coverage...`);
      
      // For each missing holding, find the best potential card
      for (const missingHolding of missingHoldings) {
        // Find potential cards that mention this holding
        const cardsForHolding = cardsRes.object.potentialCards
          .map((card, idx) => {
            const cardText = `${card.title.toUpperCase()} ${card.relatedLearnings.join(' ').toUpperCase()}`;
            
            // Check for company name match
            const companyNameMap: Record<string, string> = {
              'BLACKBERRY': 'BB',
              'LIGHTSPEED': 'LSPD',
              'NETFLIX': 'NFLX',
              'APPLE': 'AAPL',
              'NVIDIA': 'NVDA',
              'TESLA': 'TSLA',
              'MICROSOFT': 'MSFT',
              'GOOGLE': 'GOOGL',
              'AMAZON': 'AMZN',
            };
            
            // Check if card mentions the holding by ticker or company name
            let matches = false;
            if (cardText.includes(missingHolding)) {
              matches = true;
            } else {
              // Check reverse mapping (ticker -> company name)
              for (const [companyName, ticker] of Object.entries(companyNameMap)) {
                if (ticker === missingHolding && cardText.includes(companyName)) {
                  matches = true;
                  break;
                }
              }
            }
            
            if (matches) {
              return { card, index: idx };
            }
            return null;
          })
          .filter((item): item is { card: typeof cardsRes.object.potentialCards[0]; index: number } => item !== null);

        if (cardsForHolding.length > 0) {
          // Select the first/best card for this holding (prioritize by shouldInclude flag if available)
          const bestCard = cardsForHolding.sort((a, b) => {
            if (a.card.shouldInclude && !b.card.shouldInclude) return -1;
            if (!a.card.shouldInclude && b.card.shouldInclude) return 1;
            return 0;
          })[0];
          
          // Only add if not already selected
          if (!selectedCardsRes.object.selectedCardIndices.includes(bestCard.index)) {
            selectedCards.push(bestCard.card);
            selectedCardMetadata.push({ ticker: missingHolding });
            log('info', `  ✅ Added card for ${missingHolding}: "${bestCard.card.title}"`);
          }
        } else {
          log('warn', `  ⚠️  No potential cards found for ${missingHolding}`);
        }
      }
    }
  }

  log('info', `✅ Selected ${selectedCards.length} cards from ${cardsRes.object.potentialCards.length} potential cards`);
  if (finalHoldings.length > 0) {
    const coveredHoldings = new Set<string>();
    const companyNameMap: Record<string, string> = {
      'BLACKBERRY': 'BB',
      'LIGHTSPEED': 'LSPD',
      'NETFLIX': 'NFLX',
      'APPLE': 'AAPL',
      'NVIDIA': 'NVDA',
      'TESLA': 'TSLA',
      'MICROSOFT': 'MSFT',
      'GOOGLE': 'GOOGL',
      'AMAZON': 'AMZN',
    };
    
    for (const card of selectedCards) {
      const cardText = `${card.title.toUpperCase()} ${card.relatedLearnings.join(' ').toUpperCase()}`;
      
      // Check for company names
      for (const [companyName, ticker] of Object.entries(companyNameMap)) {
        if (cardText.includes(companyName) && finalHoldings.includes(ticker)) {
          coveredHoldings.add(ticker);
        }
      }
      
      // Check for ticker symbols
      for (const holding of finalHoldings) {
        if (cardText.includes(holding)) {
          coveredHoldings.add(holding);
        }
      }
    }
    log('info', `📊 Holdings coverage: ${coveredHoldings.size}/${finalHoldings.length} holdings have cards (${Array.from(coveredHoldings).join(', ')})`);
    if (coveredHoldings.size < finalHoldings.length) {
      const missing = finalHoldings.filter(h => !coveredHoldings.has(h));
      log('warn', `⚠️  Missing cards for: ${missing.join(', ')}`);
    }
  }
  log('debug', `Selection reasoning: ${selectedCardsRes.object.reasoning}`);

  // Step 3: Generate TLDR for each card
  // COMMENTED OUT: TLDR generation disabled
  // log(`📋 Generating TLDR for ${selectedCards.length} card(s)...`);
  const cardTldrs: string[] = [];
  
  // for (let i = 0; i < selectedCards.length; i++) {
  //   const card = selectedCards[i];
  //   if (!card) continue;
  //   
  //   const tldrStartTime = Date.now();
  //   log(`  [${i + 1}/${selectedCards.length}] Generating TLDR: "${card.title}"...`);
  //   
  //     const cardTldrRes = await generateObject({
  //     model: getModel(),
  //     system: `You are Wealthy Rabbit — a calm, smart financial explainer.
  // Your job is to summarize complex financial news in a way that feels simple, reassuring, and a little playful.
  // You explain things like you would to a friend who isn't great with finance but wants to feel informed, not talked down to.
  //
  // You avoid jargon, avoid hype, and avoid sounding like an analyst note.
  //
  // You often use everyday analogies (homes, bills, shopping, relationships) or short conversational quotes to make the idea click emotionally.`,
  //     prompt: trimPrompt(
  //       `Write a TLDR of the story below.
  //
  // CRITICAL FORMAT REQUIREMENT:
  // - Write using 4–6 conversational bullet points
  // - Each bullet point MUST start with "- " (dash followed by space) and be on its own line
  // - Bullets MUST be separated by SINGLE newlines (\\n) - no blank lines between bullets
  // - Format: "- [bullet text]\\n- [bullet text]\\n- [bullet text]" (each bullet on separate line, use single newline between bullets)
  // - Each bullet should feel like a short spoken sentence, not a headline
  // - Bullets should flow naturally if read out loud
  // - Do NOT sound technical, analytical, or formal
  // - MANDATORY: Every line must start with "- " (dash space) - do not omit the dash prefix
  //
  // STYLE GUIDANCE:
  // - Write like you're explaining this casually to a friend
  // - Use simple language and short sentences
  // - It's okay to use phrases like "basically," "this is like," "think of it as"
  // - You may include ONE everyday analogy across the bullets (home, bills, shopping, waiting before buying, etc.)
  // - You may include ONE casual quote if it fits (e.g. "Let's not overthink this")
  //
  // CONTENT GUIDANCE:
  // - Clearly say what actually happened (no vague summaries)
  // - Explain why it matters in plain English
  // - Focus on clarity, confidence, or calm — not predictions
  // - No finance jargon, acronyms, or numbers unless absolutely necessary
  // - No emojis
  // - No buzzwords: "optimize," "synergies," "leveraged," "strategic"
  //
  // END WITH:
  // - One final bullet that gives a soft emotional takeaway (calm, reassurance, clarity)
  //
  // STORY TO SUMMARIZE:
  // Title: ${card.title}
  // Why It Matters: ${card.whyItMatters}
  // Actionable Value: ${card.actionableValue}
  // Related Learnings: ${card.relatedLearnings.join(', ')}
  //
  // Write the TLDR now using conversational bullet points (each on its own line, separated by single newlines):`,
  //     ),
  //     schema: z.object({
  //       tldr: z.string().describe('TLDR summary: 4-6 conversational bullet points with one everyday analogy and one casual quote if it fits'),
  //     }),
  //   });
  //   
  //   cardTldrs.push(cardTldrRes.object.tldr);
  //   const tldrDuration = ((Date.now() - tldrStartTime) / 1000).toFixed(1);
  //   log(`    ✅ [${i + 1}/${selectedCards.length}] TLDR generated in ${tldrDuration}s`);
  // }
  // 
  // log(`✅ Generated ${cardTldrs.length} card TLDRs`);

  // Step 4: Generate opening paragraph separately (smaller, faster call)
  log('info', '📝 Generating opening paragraph...');
  const openingStartTime = Date.now();
  const selectedLearnings = selectedCards.flatMap(card => card.relatedLearnings);
  const selectedLearningsString = learnings
    .filter(learning => selectedLearnings.some(selected => learning.includes(selected) || selected.includes(learning)))
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  const openingRes = await generateObject({
    model: getModel(),
    system: reportStylePrompt(),
    prompt: trimPrompt(
      `Write a warm, engaging opening paragraph (1-2 paragraphs) for a financial report, written like you're catching up with a friend.

STYLE:
- Warm, conversational, engaging
- Set the stage for what's coming
- Connect the overall theme naturally
- Write like you're sharing something interesting you've been tracking

<prompt>${prompt}</prompt>

<learnings>
${selectedLearningsString}
</learnings>`,
    ),
    schema: z.object({
      opening: z.string().describe('Opening paragraph(s) for the report'),
    }),
  });

  const opening = openingRes.object.opening;
  const openingDuration = ((Date.now() - openingStartTime) / 1000).toFixed(1);
  log('info', `✅ Opening generated in ${openingDuration}s`);

  // Step 5: Generate each card separately (title + content)
  log('info', `📝 Generating ${selectedCards.length} card(s) one by one...`);
  const reportStartTime = Date.now();
  const generatedCards: Array<{ title: string; emoji?: string; content: string }> = [];

  for (let i = 0; i < selectedCards.length; i++) {
    const card = selectedCards[i];
    if (!card) continue;

    const cardStartTime = Date.now();
    log('info', `  [${i + 1}/${selectedCards.length}] Generating card: "${card.title}"...`);

    // Step 5a: Generate card title with emoji
    log('debug', `    📌 Generating title...`);
    const titleStartTime = Date.now();
    const titleRes = await generateObject({
      model: getModel(),
      system: reportStylePrompt(),
      prompt: trimPrompt(
        `Generate a card title and emoji for this story.

TITLE REQUIREMENTS:
- ONE short, message-style sentence (9-14 words)
- Follow formula: What they did + Why they did it + Why it matters
- Casual, conversational tone (like a text message)

EMOJI:
- Choose ONE relevant emoji that represents the story
- Examples: 🎬 for entertainment, 🌍 for macro, 💰 for financial, 📊 for data

STORY:
Title: ${card.title}
Why It Matters: ${card.whyItMatters}
Actionable Value: ${card.actionableValue}`,
      ),
      schema: z.object({
        emoji: z.string().describe('One emoji representing the story (required)'),
        title: z.string().describe('Card title: ONE short, message-style sentence (9-14 words)'),
      }),
    });

    const cardTitle = titleRes.object.title;
    const cardEmoji = titleRes.object.emoji;
    const titleDuration = ((Date.now() - titleStartTime) / 1000).toFixed(1);
    log('debug', `      ✅ Title generated in ${titleDuration}s: "${cardTitle}"`);

    // Step 5b: Generate card content
    log('debug', `    📄 Generating content...`);
    const contentStartTime = Date.now();
    const contentRes = await generateObject({
      model: getModel(),
      system: reportStylePrompt(),
      prompt: trimPrompt(
        `Write the deep dive content for this card, following the Wealthy Rabbit style exactly.

CRITICAL REQUIREMENTS:
- Write 4–6 paragraphs
- Each paragraph MUST start with a mini-headline on its own line
- Format: Mini-headline on line 1 (bold, no period), then SPACE DASH SPACE " - ", then paragraph content on same line
- Use DOUBLE newlines (\\n\\n) to separate paragraphs
- Mini-headlines: 3–6 words, NO period at end, conversational tone, MUST be bold using **text**
- ABSOLUTELY NO BULLET POINTS - DO NOT use "- " or "* " or any bullet point format anywhere in the content
- Write in natural, flowing paragraphs ONLY - no lists, no bullets
- Each paragraph must be complete sentences in paragraph form

EXAMPLE FORMAT:
**Here's the backstory** - The actual paragraph content goes here. This explains what happened and why it matters.

**This is the interesting part** - More paragraph content that builds on the story. Make it flow naturally.

FORBIDDEN FORMATS (DO NOT USE):
- "- " (dash space) - this is FORBIDDEN
- "* " (asterisk space) - this is FORBIDDEN  
- Any bullet point lists - FORBIDDEN
- Numbered lists - FORBIDDEN

CONTENT REQUIREMENTS:
- What happened — tell it like you're recounting something interesting
- If this card covers multiple developments for the same holding, weave them into one storyline with transitions ("Meanwhile...", "Separately...", "Also this week...")
- Why it matters and why it's in the news
- Context and backstory — weave it in naturally
- Future implications — share what you're watching
- Actionable insights — give clear, friendly guidance
- IMPORTANT NUMBERS: Include key figures from the learnings — prices, percentages, dates, earnings, guidance. Never be vague (e.g., "prices fell" is bad; "fell 15% to $78,000" is good). The investor needs concrete data.
- BENCHMARK EVERY NUMBER: When you mention a number, explain what it means — is it big or small? Compare to typical moves, prior period, or expectations. The reader should never wonder "is that good or bad?" Tell them (e.g., "a 15% drop — unusually large for a single week" or "beat estimates by 8%").

STORY:
Title: ${card.title}

Why It Matters: ${card.whyItMatters}
Actionable Value: ${card.actionableValue}
Related Learnings: ${card.relatedLearnings.join(', ')}`,
      ),
        schema: z.object({
          content: z.string().describe('Card content: 4-6 paragraphs with bold mini-headlines (no period, " - " after headline), each paragraph separated by \\n\\n'),
        }),
    });

    const cardContent = contentRes.object.content;
    const contentDuration = ((Date.now() - contentStartTime) / 1000).toFixed(1);
    log('debug', `      ✅ Content generated in ${contentDuration}s`);

    generatedCards.push({
      title: cardTitle,
      emoji: cardEmoji,
      content: cardContent,
    });

    const cardDuration = ((Date.now() - cardStartTime) / 1000).toFixed(1);
    log('info', `    ✅ [${i + 1}/${selectedCards.length}] Card complete in ${cardDuration}s`);
  }

  // Step 6: Assemble the report and build card metadata (ticker + macro from pipeline)
  log('debug', '📋 Assembling final report...');
  const cardMetadata: Array<{ ticker?: string; macro?: string }> = generatedCards.map((card, i) => {
    const ticker = selectedCardMetadata[i]?.ticker;
    const macro = detectMacroFromTitle(card.title);
    return { ticker, macro };
  });

  const cardSections = generatedCards.map((card, idx) => {
    const header = card.emoji ? `## ${card.emoji} ${card.title}` : `## ${card.title}`;
    // COMMENTED OUT: TLDR removed from report assembly
    // return `${header}\n\n${cardTldrs[idx] || ''}\n\n${card.content}`;
    return `${header}\n\n${card.content}`;
  });

  const finalReport = opening + '\n\n' + cardSections.join('\n\n');

  const totalReportTime = ((Date.now() - reportStartTime) / 1000).toFixed(1);
  log('info', `✅ Report generation complete (total time: ${totalReportTime}s)`);

  // Append the visited URLs section to the report
  const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  
  // If skipRewrite is true, return the report immediately without rewriting
  if (skipRewrite) {
    return { reportMarkdown: finalReport + urlsSection, cardMetadata };
  }

  // Step 7: Rewrite each card's content (title + content separately for better reliability)
  log('info', '✍️  Rewriting card content for human-like authenticity...');
  const reportWithRewrittenCards = await rewriteCardContent(finalReport);

  // Append the visited URLs section to the report (cardMetadata unchanged; same card count/order)
  return { reportMarkdown: reportWithRewrittenCards + urlsSection, cardMetadata };
}

// Helper function to rewrite each card's content to be more human-like
export async function rewriteCardContent(reportMarkdown: string): Promise<string> {
  log('info', '📝 Starting card content rewrite...');
  
  // Parse the report to extract opening, cards, and find where sources start
  const sourcesRegex = /^##\s+Sources\s*$/m;
  const sourcesMatch = reportMarkdown.match(sourcesRegex);
  const sourcesIndex = sourcesMatch ? sourcesMatch.index! : reportMarkdown.length;
  
  const mainContent = reportMarkdown.substring(0, sourcesIndex).trim();
  const sourcesSection = sourcesMatch ? reportMarkdown.substring(sourcesIndex).trim() : '';
  
  // Find all card headers (## followed by optional emoji and title)
  const cardHeaderRegex = /^##\s+([^\n]+)$/gm;
  const cardHeaders: Array<{ index: number; header: string }> = [];
  let match;
  
  while ((match = cardHeaderRegex.exec(mainContent)) !== null) {
    cardHeaders.push({
      index: match.index,
      header: match[0],
    });
  }
  
  // If no cards found, return original (might just be opening paragraph)
  if (cardHeaders.length === 0) {
    log('warn', '⚠️  No cards found to rewrite');
    return reportMarkdown;
  }
  
  log('info', `📋 Found ${cardHeaders.length} card(s) to rewrite`);
  
  // Extract opening (content before first card)
  const firstCard = cardHeaders[0];
  if (!firstCard) {
    return reportMarkdown;
  }
  
  // Opening includes everything before first card
  const opening = mainContent.substring(0, firstCard.index).trim();
  
  // Extract each card's content
  const cards: Array<{ header: string; content: string; tldr?: string }> = [];
  for (let i = 0; i < cardHeaders.length; i++) {
    const currentCard = cardHeaders[i];
    const nextCard = i < cardHeaders.length - 1 ? cardHeaders[i + 1] : null;
    
    if (!currentCard) continue;
    
    const startIndex = currentCard.index + currentCard.header.length;
    const endIndex = nextCard ? nextCard.index : mainContent.length;
    const fullContent = mainContent.substring(startIndex, endIndex).trim();
    
    // COMMENTED OUT: TLDR extraction disabled
    // // Check if this card has TLDR bullets (starts with "- " after header, or has ### TLDR header)
    // const tldrHeaderMatch = fullContent.match(/^###\s+TLDR\s*\n(.*?)(?=\n\n|$)/is);
    // const tldrBulletsMatch = fullContent.match(/^(.*?)(?=\n\n[A-Z]|\n\n###|$)/s);
    // let tldr: string | undefined;
    // let content: string;
    // 
    // if (tldrHeaderMatch) {
    //   // Has ### TLDR header - extract bullets
    //   tldr = tldrHeaderMatch[1].trim(); // Just the bullets, not the header
    //   const tldrEndIndex = tldrHeaderMatch.index! + tldrHeaderMatch[0].length;
    //   content = fullContent.substring(tldrEndIndex).trim();
    // } else if (tldrBulletsMatch && /^-\s/.test(tldrBulletsMatch[1].trim())) {
    //   // Starts directly with bullets (no header)
    //   tldr = tldrBulletsMatch[1].trim();
    //   const tldrEndIndex = tldrBulletsMatch.index! + tldrBulletsMatch[0].length;
    //   content = fullContent.substring(tldrEndIndex).trim();
    // } else {
    //   content = fullContent;
    // }
    
    // TLDR disabled - use full content as-is
    const content = fullContent;
    const tldr: string | undefined = undefined;
    
    cards.push({
      header: currentCard.header,
      content,
      tldr,
    });
  }
  
  // Rewrite each card in smaller steps: title first, then content
  const rewrittenCards: string[] = [];
  const totalCards = cards.length;
  
  log('info', `📝 Starting rewrite of ${totalCards} card(s) (title + content separately)...`);
  
  for (let cardIndex = 0; cardIndex < cards.length; cardIndex++) {
    const card = cards[cardIndex];
    if (!card) continue;
    
    const originalHeader = card.header;
    const cardTitleMatch = originalHeader.match(/^##\s*(?:([^\s]+)\s+)?(.+)$/);
    const originalEmoji = cardTitleMatch?.[1] || null;
    const originalTitle = cardTitleMatch?.[2] || `Card ${cardIndex + 1}`;
    
    log('info', `  [${cardIndex + 1}/${totalCards}] Rewriting: ${originalTitle}...`);
    const cardStartTime = Date.now();
    
    try {
      // Step 7a: Rewrite title only (fast, ~5s)
      log('debug', `    📌 Rewriting title...`);
      const titleRewriteStartTime = Date.now();
      const titleRes = await generateObject({
        model: getModel(),
        system: `You are an expert editor. Your task is to rewrite the title to be more human-like while maintaining the exact same meaning.`,
        prompt: `Rewrite this card title to sound more human and natural, while keeping the EXACT SAME meaning.

CRITICAL REQUIREMENTS:
- Keep it as ONE short, message-style sentence (9-14 words)
- Maintain the EXACT SAME meaning and core concepts - only change word choices, not concepts
- Follow the magic formula: What they did + Why they did it + Why it matters
- Sound authentically human but maintain exact same meaning

Original title: ${originalTitle}

Return ONLY the rewritten title as ONE sentence (9-14 words), no explanation.`,
        schema: z.object({
          rewrittenTitle: z.string().describe('Rewritten title: ONE short, message-style sentence (9-14 words) that sounds authentically human but maintains exact same meaning'),
        }),
      });

      const rewrittenTitle = titleRes.object.rewrittenTitle;
      const titleDuration = ((Date.now() - titleRewriteStartTime) / 1000).toFixed(1);
      log('debug', `      ✅ Title rewritten in ${titleDuration}s: "${rewrittenTitle}"`);

      // Step 7b: Rewrite content only (slower, ~30-60s)
      log('debug', `    📄 Rewriting content...`);
      const contentRewriteStartTime = Date.now();
      const rewrittenContent = await generateObject({
        model: getModel(),
        system: `You are an expert editor. Your task is to ensure the text has proper paragraph breaks, mini-headlines, and natural flow.`,
        prompt: `Edit the following text to ensure it has proper paragraph structure with mini-headlines and natural flow.

CRITICAL FORMAT REQUIREMENTS:
- Each paragraph MUST start with a mini-headline (3-6 words, NO period, MUST be bold using **text**)
- Format: Mini-headline on line 1 (bold, no period), then SPACE DASH SPACE " - ", then paragraph content on same line
- Use DOUBLE newlines (\\n\\n) to separate different paragraphs
- Each paragraph: 2-4 sentences on one main idea
- ABSOLUTELY NO BULLET POINTS - Remove any "- " or "* " or bullet point formatting
- Convert any bullet points to flowing paragraph text
- Maintain original meaning and key information
- PRESERVE ALL IMPORTANT NUMBERS: prices, percentages, dates, earnings figures, dollar amounts — do not remove or generalize them
- PRESERVE BENCHMARKS: Keep any context that explains what numbers mean (e.g., "unusually large", "beat estimates", "lowest since March")
- Keep the conversational, human tone
- Ensure paragraphs flow naturally

EXAMPLE FORMAT:
**Here's the backstory** - The actual paragraph content goes here. This explains what happened and why it matters.

**This is the interesting part** - More paragraph content that builds on the story. Make it flow naturally.

FORBIDDEN: Remove all bullet points ("- ", "* ", numbered lists) and convert to paragraph format.

Text to edit:

${card.content}`,
        schema: z.object({
          rewrittenContent: z.string().describe('Edited content with bold mini-headlines (no period, " - " after headline, then paragraph on same line) and paragraph breaks (\\n\\n between paragraphs)'),
        }),
      });
      
      const contentDuration = ((Date.now() - contentRewriteStartTime) / 1000).toFixed(1);
      
      if (rewrittenContent?.object?.rewrittenContent) {
        // Reconstruct card with rewritten title and content
        const newHeader = originalEmoji 
          ? `## ${originalEmoji} ${rewrittenTitle}`
          : `## ${rewrittenTitle}`;
        // COMMENTED OUT: TLDR removed from card reconstruction
        // const cardWithTLDR = card.tldr 
        //   ? newHeader + '\n\n' + card.tldr + '\n\n' + rewrittenContent.object.rewrittenContent
        //   : newHeader + '\n\n' + rewrittenContent.object.rewrittenContent;
        const cardContent = newHeader + '\n\n' + rewrittenContent.object.rewrittenContent;
        rewrittenCards.push(cardContent);
        
        const cardDuration = ((Date.now() - cardStartTime) / 1000).toFixed(1);
        log('debug', `      ✅ Content rewritten in ${contentDuration}s`);
        log('info', `    ✅ [${cardIndex + 1}/${totalCards}] Completed in ${cardDuration}s (title: ${titleDuration}s, content: ${contentDuration}s)`);
      } else {
        log('warn', `    ⚠️  [${cardIndex + 1}/${totalCards}] No rewritten content returned, using original`);
        const newHeader = originalEmoji 
          ? `## ${originalEmoji} ${rewrittenTitle}`
          : `## ${rewrittenTitle}`;
        // COMMENTED OUT: TLDR removed from card reconstruction
        // const cardWithTLDR = card.tldr 
        //   ? newHeader + '\n\n' + card.tldr + '\n\n' + card.content
        //   : newHeader + '\n\n' + card.content;
        const cardContent = newHeader + '\n\n' + card.content;
        rewrittenCards.push(cardContent);
      }
    } catch (error) {
      const cardDuration = ((Date.now() - cardStartTime) / 1000).toFixed(1);
      log('error', `    ❌ [${cardIndex + 1}/${totalCards}] Error after ${cardDuration}s: ${error instanceof Error ? error.message : String(error)}`);
      // Use original card if rewrite fails
      // COMMENTED OUT: TLDR removed from card reconstruction
      // const cardWithTLDR = card.tldr 
      //   ? originalHeader + '\n\n' + card.tldr + '\n\n' + card.content
      //   : originalHeader + '\n\n' + card.content;
      const cardContent = originalHeader + '\n\n' + card.content;
      rewrittenCards.push(cardContent);
    }
  }
  
  log('info', `✅ Completed rewriting ${rewrittenCards.length}/${totalCards} cards`);
  
  // Reconstruct the report with rewritten cards
  const rewrittenReport = opening + '\n\n' + rewrittenCards.join('\n\n');
  
  log('info', `✅ Card rewrite complete: ${rewrittenCards.length}/${totalCards} cards rewritten`);
  
  return rewrittenReport + '\n\n' + sourcesSection;
}

export async function writeFinalAnswer({
  prompt,
  learnings,
}: {
  prompt: string;
  learnings: string[];
}) {
  const learningsString = learnings
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: trimPrompt(
      `Given the following prompt from the user, write a final answer on the topic using the learnings from research. Follow the format specified in the prompt. Do not yap or babble or include any other text than the answer besides the format specified in the prompt. Keep the answer as concise as possible - usually it should be just a few words or maximum a sentence. Try to follow the format specified in the prompt (for example, if the prompt is using Latex, the answer should be in Latex. If the prompt gives multiple answer choices, the answer should be one of the choices).\n\n<prompt>${prompt}</prompt>\n\nHere are all the learnings from research on the topic that you can use to help answer the prompt:\n\n<learnings>\n${learningsString}\n</learnings>`,
    ),
    schema: z.object({
      exactAnswer: z
        .string()
        .describe('The final answer, make it short and concise, just the answer, no other text'),
    }),
  });

  return res.object.exactAnswer;
}

/**
 * Detect if query contains multiple holdings that should be researched individually
 */
function detectPortfolioQuery(query: string): Array<{ symbol: string; type: string; name: string }> | null {
  // Pattern: "SYMBOL (Type)" or "SYMBOL (Type): Name" - matches format like "BTC (Cryptocurrency), XRP (Cryptocurrency)"
  const holdingPattern = /(\w+)\s*\(([^)]+)\)(?:\s*:\s*([^,\.]+))?/gi;
  const holdings: Array<{ symbol: string; type: string; name: string }> = [];
  let match;
  
  while ((match = holdingPattern.exec(query)) !== null) {
    const symbol = match[1].trim();
    const type = match[2].trim().toLowerCase();
    const name = match[3]?.trim() || symbol;
    
    // Only include if it's a recognized asset type
    const validTypes = ['stock', 'cryptocurrency', 'crypto', 'commodity', 'real estate', 'realestate'];
    if (validTypes.some(vt => type.includes(vt))) {
      holdings.push({
        symbol: symbol.toUpperCase(),
        type: type.includes('crypto') ? 'Cryptocurrency' : 
              type.includes('commodity') ? 'Commodity' :
              type.includes('real') ? 'Real Estate' :
              'Stock',
        name,
      });
    }
  }

  // If we found 3+ holdings, treat as portfolio query
  return holdings.length >= 3 ? holdings : null;
}

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
  dataSaver,
  iteration = 0,
  initialQuery,
  totalDepth,
  researchLabel,
  dbRunId,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
  dataSaver?: PipelineDataSaver;
  iteration?: number;
  initialQuery?: string;
  totalDepth?: number;
  researchLabel?: string; // Label for this research (e.g., "BTC", "NVIDIA") - used for portfolio research
  dbRunId?: string; // When set, saves pipeline stages (gathered, triaged, filter, scraped) to DB
}): Promise<ResearchResult> {
  log('debug', `🔍 deepResearch called: query="${query.substring(0, 100)}...", iteration=${iteration}, breadth=${breadth}, depth=${depth}`);
  
  // Track initial values for first iteration
  const isFirstIteration = iteration === 0;
  const finalInitialQuery = initialQuery || query;
  const finalTotalDepth = totalDepth || depth;
  
  // Check if this is a portfolio query (only on first iteration)
  if (isFirstIteration) {
    const portfolioHoldings = detectPortfolioQuery(query);
    
    if (portfolioHoldings && portfolioHoldings.length >= 3) {
      log('info', `\n📊 Detected portfolio query with ${portfolioHoldings.length} holdings. Researching each individually...\n`);
      
      const allPortfolioLearnings: string[] = [];
      const allPortfolioUrls: string[] = [];
      
      // Research each holding individually (with a flag to prevent recursion)
      const breadthPerHolding = Math.max(2, Math.floor(breadth / portfolioHoldings.length));
      const depthPerHolding = 1; // Depth 1 for individual holdings
      
      for (const holding of portfolioHoldings) {
        log('info', `📊 Researching ${holding.symbol} (${holding.type})...`);
        
        // Create specific query for this holding
        let holdingQuery = '';
        if (holding.type === 'Stock') {
          holdingQuery = `Research ${holding.symbol} (${holding.name}) stock news and developments from the last 7 days.

IMPORTANT: Generate queries that include:
1. At least one broad, simple query for general recent news (e.g., "${holding.name} news January 2026" or "${holding.symbol} stock news last week")
2. Include queries about: earnings releases, SEC filings (8-K, 10-Q, 10-K), regulatory actions, official announcements, partnerships, price movements, analyst updates
3. Use date ranges like "January 2026" or "last week" - avoid restrictive "last 7 days" quotes
4. Start with broad news queries, then add specific technical queries

Focus on: earnings releases, SEC filings (8-K, 10-Q, 10-K), regulatory actions, official announcements, partnerships, price movements, analyst updates. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ, SEC filings).`;
        } else if (holding.type === 'Cryptocurrency') {
          // For crypto, use both symbol and common name (e.g., BTC and Bitcoin)
          const cryptoName = holding.symbol === 'BTC' ? 'Bitcoin' : 
                           holding.symbol === 'XRP' ? 'Ripple' : 
                           holding.symbol === 'ETH' ? 'Ethereum' :
                           holding.name || holding.symbol;
          holdingQuery = `Research ${holding.symbol} (${cryptoName}) cryptocurrency news and developments from the last 7 days. 

IMPORTANT: Generate queries that include:
1. At least one broad, simple query for general recent news (e.g., "${cryptoName} news January 2026" or "${holding.symbol} cryptocurrency news last week")
2. Search for both "${holding.symbol}" and "${cryptoName}" terms in all queries
3. Include queries about: protocol upgrades, institutional adoption, regulatory news, major hacks (confirmed), price movements, exchange listings, crypto market trends
4. Use date ranges like "January 2026" or "last week" - avoid restrictive "last 7 days" quotes
5. Start with broad news queries, then add specific technical queries

Focus on: protocol upgrades, institutional adoption announcements, regulatory news, major hacks (confirmed), price movements, exchange listings, crypto market trends. Prioritize Tier 1 sources (Reuters, Bloomberg, official project announcements).`;
        } else if (holding.type === 'Commodity') {
          holdingQuery = `Research ${holding.symbol} (${holding.name}) commodity news and developments from the last 7 days.

IMPORTANT: Generate queries that include:
1. At least one broad, simple query for general recent news (e.g., "${holding.name} prices January 2026" or "${holding.symbol} commodity news last week")
2. Include queries about: price data (actual numbers), supply/demand data (official sources like EIA, OPEC), producer decisions, inventory levels, geopolitical factors affecting supply
3. Use date ranges like "January 2026" or "last week" - avoid restrictive "last 7 days" quotes
4. Start with broad news queries, then add specific technical queries

Focus on: price data (actual numbers), supply/demand data (official sources like EIA, OPEC), producer decisions, inventory levels, geopolitical factors affecting supply. Prioritize Tier 1 sources (Reuters, Bloomberg, EIA, OPEC, government data).`;
        } else if (holding.type === 'Real Estate') {
          holdingQuery = `Research ${holding.symbol} (Real Estate Investment Trusts) REIT news and developments from the last 7 days.

IMPORTANT: Generate queries that include:
1. At least one broad, simple query for general recent news (e.g., "REIT news January 2026" or "${holding.symbol} real estate news last week")
2. Include queries about: earnings releases, SEC filings, property acquisitions/dispositions, dividend announcements, interest rate impacts, sector trends
3. Use date ranges like "January 2026" or "last week" - avoid restrictive "last 7 days" quotes
4. Start with broad news queries, then add specific technical queries

Focus on: earnings releases, SEC filings, property acquisitions/dispositions, dividend announcements, interest rate impacts, sector trends. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ, SEC filings).`;
        } else {
          // Generic query for unknown types
          holdingQuery = `Research ${holding.symbol} (${holding.name}) news and developments from the last 7 days.

IMPORTANT: Generate queries that include:
1. At least one broad, simple query for general recent news (e.g., "${holding.name} news January 2026" or "${holding.symbol} news last week")
2. Use date ranges like "January 2026" or "last week" - avoid restrictive "last 7 days" quotes
3. Start with broad news queries, then add specific technical queries

        Focus on factual updates from Tier 1 sources (Reuters, Bloomberg, FT, WSJ).`;
        }

        try {
          log('debug', `  🔍 Query for ${holding.symbol}: ${holdingQuery.substring(0, 150)}...`);
          // Call deepResearch with iteration > 0 to prevent portfolio detection recursion
          // Pass researchLabel to track which holding this is for
          const { learnings: holdingLearnings, visitedUrls: holdingUrls } = await deepResearch({
            query: holdingQuery,
            breadth: breadthPerHolding,
            depth: depthPerHolding,
            learnings: [],
            visitedUrls: [],
            onProgress,
            dataSaver,
            iteration: 1, // Set iteration to 1 to skip portfolio detection
            initialQuery: holdingQuery,
            totalDepth: depthPerHolding,
            researchLabel: holding.symbol, // Pass research label to track which holding
            dbRunId,
          });

          log('info', `  ✅ ${holding.symbol}: ${holdingLearnings.length} learnings, ${holdingUrls.length} URLs`);
          if (holdingLearnings.length === 0) {
            log('warn', `  ⚠️  Warning: No learnings found for ${holding.symbol}. This may indicate no articles were found or all were rejected in triage.`);
          }
          allPortfolioLearnings.push(...holdingLearnings);
          allPortfolioUrls.push(...holdingUrls);
        } catch (error) {
          log('error', `  ❌ Error researching ${holding.symbol}:`, error);
        }
      }

      log('info', `\n✅ Portfolio holdings research complete!`);
      log('info', `  Total holdings learnings: ${allPortfolioLearnings.length}`);
      log('info', `  Total holdings URLs: ${allPortfolioUrls.length}\n`);

      // Check if query mentions macro factors - if so, add macro research
      const needsMacro = /\b(macro|Fed|Federal Reserve|inflation|currency|geopolitical|economic|central bank)\b/i.test(query);
      
      if (needsMacro) {
        log('info', '🌍 Query mentions macro factors. Adding macro research...\n');
        try {
          const { scanMacro } = await import('./macro-scan');
          const macroResult = await scanMacro(2, 1, dataSaver, undefined, dbRunId);
          log('info', `  ✅ Macro learnings: ${macroResult.learnings.length}`);
          log('info', `  ✅ Macro URLs: ${macroResult.visitedUrls.length}\n`);
          allPortfolioLearnings.push(...macroResult.learnings);
          allPortfolioUrls.push(...macroResult.visitedUrls);
        } catch (error) {
          log('error', `  ⚠️  Error in macro scan:`, error);
        }
      }

      // Return combined results
      return {
        learnings: allPortfolioLearnings,
        visitedUrls: allPortfolioUrls,
      };
    }
  }

  // Continue with normal research flow (either not first iteration, or first iteration but not a portfolio query)
  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: finalTotalDepth,
    currentBreadth: breadth,
    totalBreadth: breadth,
    totalQueries: 0,
    completedQueries: 0,
  };

  const reportProgress = (update: Partial<ResearchProgress>) => {
    Object.assign(progress, update);
    onProgress?.(progress);
  };

  // Step 1: Generate all SERP queries
  const serpQueries = await generateSerpQueries({
    query,
    learnings,
    numQueries: breadth,
  });

  log('info', `📝 Generated ${serpQueries.length} search queries`);
  log('debug', serpQueries.map((q, i) => `   ${i + 1}. ${q.query}`).join('\n'));
  
  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
  });

  const limit = pLimit(ConcurrencyLimit);

  // Step 2: Gather ALL search results first (metadata only, no scraping)
  log('info', `\n🔍 Gathering search results from ${serpQueries.length} queries...`);
  const allSearchResults = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          const searchResult = await retryFirecrawlSearch(
            () => firecrawl.search(serpQuery.query, {
              limit: 30, // Get more results to triage from
              // NO scrapeOptions - just get metadata (titles, descriptions, URLs)
            }),
            serpQuery.query,
            0,
            'search'
          );

          return {
            query: serpQuery.query,
            researchGoal: serpQuery.researchGoal,
            results: searchResult.data.map(item => ({
              url: item.url,
              title: (item as any).title || (item as any).metadata?.title,
              description: (item as any).description || (item as any).snippet,
              snippet: (item as any).snippet,
              publishedDate: (item as any).publishedDate || (item as any).metadata?.publishedDate || (item as any).metadata?.publishedTime,
            })),
          };
        } catch (e: any) {
          if (e.message && e.message.includes('Timeout')) {
            log('warn', `Timeout error running query: ${serpQuery.query}: `, e);
          } else {
            log('error', `Error running query: ${serpQuery.query}: `, e);
          }
          return {
            query: serpQuery.query,
            researchGoal: serpQuery.researchGoal,
            results: [],
          };
        }
      })
    )
  );

  // Step 3: Combine and deduplicate by URL across all queries
  const urlMap = new Map<string, {
    url: string;
    title?: string;
    description?: string;
    snippet?: string;
    publishedDate?: string;
    sourceQueries: string[];
    researchGoals: string[];
  }>();

  for (const searchResult of allSearchResults) {
    for (const article of searchResult.results) {
      if (urlMap.has(article.url)) {
        // Already seen - add query/goal to existing entry
        const existing = urlMap.get(article.url)!;
        if (!existing.sourceQueries.includes(searchResult.query)) {
          existing.sourceQueries.push(searchResult.query);
        }
        if (!existing.researchGoals.includes(searchResult.researchGoal)) {
          existing.researchGoals.push(searchResult.researchGoal);
        }
      } else {
        // New article
        urlMap.set(article.url, {
          url: article.url,
          title: article.title,
          description: article.description,
          publishedDate: article.publishedDate,
          snippet: article.snippet,
          sourceQueries: [searchResult.query],
          researchGoals: [searchResult.researchGoal],
        });
      }
    }
  }

  const allArticles = Array.from(urlMap.values());
  const totalBeforeDedup = allSearchResults.reduce((sum, r) => sum + r.results.length, 0);
  log('info', `📊 Gathered ${allArticles.length} unique articles from ${totalBeforeDedup} total results (${totalBeforeDedup - allArticles.length} duplicates removed)`);

  if (allArticles.length === 0) {
    log('warn', `⚠️  No articles found for any query. Query was: "${query.substring(0, 200)}..."`);
    log('warn', `   This may indicate: 1) Search queries didn't match any articles, 2) All results were filtered out, or 3) Search API issue.`);
    // Still save iteration data even if no articles found, so we can debug
    if (dataSaver) {
      await dataSaver.saveIterationData(iteration, {
        depth,
        query,
        researchLabel,
        serpQueries: serpQueries.map(q => q.query),
        gatheredArticles: [],
        triagedArticles: [],
        toScrape: [],
        metadataOnly: [],
        scrapedContent: [],
        learnings: [],
        followUpQuestions: [],
        visitedUrls: [],
      });
    }
    if (dbRunId) {
      await savePipelineIteration({
        runId: dbRunId,
        researchLabel,
        iteration,
        depth,
        query,
        serpQueries,
        gatheredArticles: [],
        triagedArticles: [],
        toScrape: [],
        metadataOnly: [],
        scrapedContent: [],
      });
    }
    return {
      learnings: [],
      visitedUrls: [],
    };
  }

  // Step 4: Batch triage - process all articles together
  log('info', `\n🔍 Batch triaging ${allArticles.length} articles...`);
  const BATCH_SIZE = 50; // Process in batches to avoid token limits
  const triagedArticles: typeof allArticles = [];
  const allResearchGoals = [...new Set(allSearchResults.flatMap(r => r.researchGoal))];

  for (let i = 0; i < allArticles.length; i += BATCH_SIZE) {
    const batch = allArticles.slice(i, i + BATCH_SIZE);
    const triagedUrls = await triageTitlesBatched({
      query: query,
      results: batch,
      researchGoals: allResearchGoals,
    });

    const batchTriaged = batch.filter(a => triagedUrls.includes(a.url));
    triagedArticles.push(...batchTriaged);
  }

  log('info', `✅ Triage: Selected ${triagedArticles.length} articles from ${allArticles.length} unique results`);

  if (triagedArticles.length === 0) {
    log('warn', `No relevant articles selected after triage`);
    if (dbRunId) {
      await savePipelineIteration({
        runId: dbRunId,
        researchLabel,
        iteration,
        depth,
        query,
        serpQueries,
        gatheredArticles: allArticles,
        triagedArticles: [],
        toScrape: [],
        metadataOnly: [],
        scrapedContent: [],
      });
    }
    return {
      learnings: [],
      visitedUrls: [],
    };
  }

  // Step 5: Batch filter - decide scrape vs metadata (with story deduplication)
  log('info', `\n🔍 Batch filtering ${triagedArticles.length} triaged articles...`);
  const { toScrape, metadataOnly } = await filterScrapeNeedsBatched({
    query: query,
    triagedResults: triagedArticles,
    researchGoals: allResearchGoals,
  });

  log('info', `✅ Filter: ${toScrape.length} to scrape, ${metadataOnly.length} metadata-only`);

  // Step 6: Scrape all selected articles in parallel
  log('info', `\n📥 Scraping ${toScrape.length} articles...`);
  const scrapedResults = await Promise.all(
    toScrape.map(({ url }) =>
      retryFirecrawlSearch(
        async () => {
          // Firecrawl scrape method - try different possible method names
          if (typeof (firecrawl as any).scrapeUrl === 'function') {
            return await (firecrawl as any).scrapeUrl(url, { formats: ['markdown'], onlyMainContent: true });
          } else if (typeof (firecrawl as any).scrape === 'function') {
            return await (firecrawl as any).scrape(url, { formats: ['markdown'], onlyMainContent: true });
          } else {
            // Fallback: use search with scrapeOptions for single URL
            const result = await firecrawl.search(`site:${new URL(url).hostname} ${url}`, {
              limit: 1,
              scrapeOptions: { formats: ['markdown'] },
            });
            return result.data[0] || { url, markdown: '' };
          }
        },
        url,
        0,
        'scrape'
      )
    )
  );

  // Prepare scraped content: parse date from markdown or URL; keep only items with a date (filter before report)
  const scrapedContent = scrapedResults.map((scraped, index) => {
    const url = toScrape[index]?.url ?? '';
    const markdown = 
      scraped?.markdown || 
      scraped?.data?.markdown || 
      scraped?.content?.markdown || 
      (typeof scraped === 'string' ? scraped : '');
    const publishedDate = (markdown ? parseDateFromMarkdown(markdown) : null) || parseDateFromUrl(url);
    return {
      url,
      markdown: markdown || undefined,
      publishedDate: publishedDate ?? undefined,
      error: markdown ? undefined : 'No markdown content returned',
    };
  });

  const withDate = scrapedContent.filter(c => c.markdown && c.publishedDate);
  const noDate = scrapedContent.filter(c => c.markdown && !c.publishedDate);
  if (noDate.length > 0) {
    log('info', `📅 Date filter: ${noDate.length} scraped article(s) with no parseable date excluded (${withDate.length} kept)`);
  }

  // Metadata-only: only include if URL has a parseable date (same filter)
  const metadataWithDate = metadataOnly.filter(meta => parseDateFromUrl(meta.url));
  const metadataNoDate = metadataOnly.filter(meta => !parseDateFromUrl(meta.url));
  if (metadataNoDate.length > 0 && metadataOnly.length > 0) {
    log('info', `📅 Date filter: ${metadataNoDate.length} metadata-only article(s) with no date in URL excluded (${metadataWithDate.length} kept)`);
  }

  // Step 7: Combine scraped results + metadata-only into SearchResponse format (only items with a date)
  const combinedResult = {
    data: [
      ...withDate.map(c => ({
        url: c.url,
        markdown: c.markdown!,
        ...(c.publishedDate && { publishedDate: c.publishedDate }),
      })),
      ...metadataWithDate.map(meta => ({
        url: meta.url,
        markdown: `Title: ${meta.title || 'No title'}\n\nDescription: ${meta.description || (meta as any).snippet || 'No description'}\n\n[Metadata only - not fully scraped. Reason: ${meta.reason}]`,
      })),
    ],
  } as SearchResponse;

  // Collect URLs from this iteration
  const newUrls = compact(combinedResult.data.map(item => item.url));
  const newBreadth = Math.ceil(breadth / 2);
  const newDepth = depth - 1;

  // Step 8: Process all results together (better context)
  log('info', `\n📝 Processing ${combinedResult.data.length} articles to extract learnings...`);
  const newLearnings = await processSerpResult({
    query: query, // Use original query for context
    result: combinedResult,
    numFollowUpQuestions: newBreadth,
  });

  const allLearnings = [...learnings, ...newLearnings.learnings];
  const allUrls = [...visitedUrls, ...newUrls];

  // Save iteration data if dataSaver is provided
  if (dataSaver) {
    // Get follow-up questions from previous iteration if this is not the first iteration
    const previousFollowUps = iteration > 0 && learnings.length > 0 
      ? (dataSaver as any).iterations?.[iteration - 1]?.followUpQuestions || []
      : undefined;

    await dataSaver.saveIterationData(iteration, {
      depth,
      query,
      researchLabel,
      serpQueries,
      gatheredArticles: allArticles,
      triagedArticles,
      toScrape,
      metadataOnly,
      scrapedContent,
      learnings: newLearnings.learnings,
      followUpQuestions: newLearnings.followUpQuestions,
      visitedUrls: newUrls,
      previousIterationFollowUps: previousFollowUps,
    });
  }

  // Save pipeline stages to DB when dbRunId is provided
  if (dbRunId) {
    await savePipelineIteration({
      runId: dbRunId,
      researchLabel,
      iteration,
      depth,
      query,
      serpQueries,
      gatheredArticles: allArticles,
      triagedArticles,
      toScrape,
      metadataOnly,
      scrapedContent,
    });
  }

  // Step 9: Recursive depth exploration
  if (newDepth > 0) {
    log('info', `\n🔍 Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`);

    reportProgress({
      currentDepth: newDepth,
      currentBreadth: newBreadth,
      completedQueries: serpQueries.length,
    });

    // Combine all follow-up questions from all queries
    const nextQuery = `
    Previous research goals: ${allSearchResults.map(r => r.researchGoal).join('; ')}
    Follow-up research directions: ${newLearnings.followUpQuestions.map(q => `\n${q}`).join('')}
  `.trim();

    return deepResearch({
      query: nextQuery,
      breadth: newBreadth,
      depth: newDepth,
      learnings: allLearnings,
      visitedUrls: allUrls,
      onProgress,
      dataSaver,
      iteration: iteration + 1,
      initialQuery: finalInitialQuery,
      dbRunId,
      totalDepth: finalTotalDepth,
      researchLabel, // Pass research label to next iteration
    });
  } else {
    reportProgress({
      currentDepth: 0,
      completedQueries: serpQueries.length,
    });

    log('info', `\n✅ Research complete! Collected ${allLearnings.length} learnings from ${allUrls.length} URLs`);
    
    // If we have a data saver, log the run directory
    if (dataSaver) {
      log('debug', `📁 Research data saved to: ${dataSaver.getRunDir()}`);
    }
    
    log('debug', `  Returning final results: ${allLearnings.length} learnings, ${allUrls.length} URLs`);
    return {
      learnings: allLearnings,
      visitedUrls: allUrls,
    };
  }
}
