import FirecrawlApp, { SearchResponse } from '@mendable/firecrawl-js';
import { generateObject } from 'ai';
import { compact } from 'lodash-es';
import pLimit from 'p-limit';
import { z } from 'zod';

import { getModel, trimPrompt } from './ai/providers';
import { systemPrompt, reportStylePrompt } from './prompt';

function log(...args: any[]) {
  console.log(...args);
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
): Promise<T> {
  try {
    return await searchFn();
  } catch (error: any) {
    const statusCode = error.statusCode || error.status;
    const isRetryable = statusCode === 429 || statusCode === 500 || statusCode === 502 || statusCode === 503;
    
    // Don't retry on insufficient credits (402) or other non-retryable errors
    if (!isRetryable || retryCount >= MAX_RETRIES) {
      if (statusCode === 402) {
        log(`Error running query: ${query}: Insufficient credits. Please upgrade your plan.`);
      } else if (retryCount >= MAX_RETRIES) {
        log(`Error running query: ${query}: Max retries (${MAX_RETRIES}) exceeded.`);
      }
      throw error;
    }

    // Calculate delay with exponential backoff
    const retryAfter = getRetryAfter(error);
    const delay = Math.min(
      retryAfter * Math.pow(2, retryCount),
      MAX_RETRY_DELAY
    );

    log(`Error running query: ${query}: ${error.message || error}. Retrying in ${delay/1000}s (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
    
    await sleep(delay);
    return retryFirecrawlSearch(searchFn, query, retryCount + 1);
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
  const isCommodityQuery = /\b(oil|energy|gas|crude|commodit|natural gas|LNG|petroleum|OPEC|WTI|Brent)\b/i.test(query);
  const isCompanyQuery = /\b(NVIDIA|AAPL|MSFT|GOOGL|JPM|XOM|Exxon|company|earnings|stock)\b/i.test(query);
  
  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Given the following prompt from the user, generate a list of SERP queries to research the topic. Return a maximum of ${numQueries} queries, but feel free to return less if the original prompt is clear. Make sure each query is unique and not similar to each other.

STRICT REQUIREMENTS:
- Focus on information published in the LAST 7 DAYS only
- Prioritize Tier 1 sources: Reuters, Bloomberg, FT, WSJ, company filings, EIA, OPEC, government data
- Avoid consulting blogs, generic outlooks, aggregators (MarketMinute, FinancialContent)

${isCommodityQuery ? `FOR COMMODITIES/ENERGY QUERIES (like this one), you MUST include queries about:
- Current price levels and recent price movements (search for actual current prices)
- Supply vs demand balance (is supply exceeding demand? vice versa?)
- Inventory levels (are inventories rising or falling?)
- OPEC/producer behavior (what are producers doing?)
- Price reactions (why are prices reacting or NOT reacting to developments?)` : ''}

${isCompanyQuery ? `FOR COMPANY QUERIES, include queries about:
- Specific company filings or earnings releases
- Holdings-level impact (what does this mean for holders?)
- Company-specific implications (bullish/neutral/bearish? near-term vs long-term?)` : ''}

IMPORTANT: When researching companies, look for:
- Strategic implications and directional indicators (where is the company heading?)
- What events reveal about company power/position (not just what happened, but what it means)
- Competitive dynamics and market positioning (who has leverage and why?)
- Regulatory/political impacts that show company strength (e.g., if a company can require upfront payments despite regulatory pressure, that shows power)

CRITICAL: Capture as many different stories, events, and developments as possible. Generate queries that will uncover multiple significant events, regulatory changes, strategic moves, competitive dynamics, market shifts, earnings surprises, product launches, partnerships, regulatory battles, etc. The goal is to gather a rich collection of stories, not just focus on one angle.

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
  log(`Created ${res.object.queries.length} queries`, res.object.queries);

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
   - REJECT articles that are just "2025 outlook" or "2030 projections" without recent news
   - REJECT articles clearly outside the 7-day window unless they provide critical context

3. CONTENT RELEVANCE AND IMPORTANCE:
   - Select articles with strategic implications and directional indicators
   - Select articles with shocking/first-time developments ("for the first time ever", "unprecedented", "historic reversal")
   - Select articles that reveal company power/position (not just news events)
   - Select articles with competitive dynamics and market positioning insights
   - Select articles with regulatory/political impacts that show company strength
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

  log(`Triage: Selected ${res.object.selectedUrls.length} articles from ${results.length} results`);
  log(`Triage reasoning: ${res.object.reasoning}`);

  return res.object.selectedUrls;
}

// Batched triage - processes all articles together with better deduplication
export async function triageTitlesBatched({
  query,
  results,
  researchGoals,
}: {
  query: string;
  results: Array<{ url: string; title?: string; description?: string; snippet?: string }>;
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

  const titlesList = uniqueResults
    .map((r, i) => {
      const title = r.title || 'No title';
      const desc = r.description || r.snippet || 'No description';
      return `${i + 1}. Title: ${title}\n   Description: ${desc}\n   URL: ${r.url}`;
    })
    .join('\n\n');

  const researchGoalsText = researchGoals.length > 0 
    ? `\n\nResearch Goals:\n${researchGoals.map((goal, i) => `${i + 1}. ${goal}`).join('\n')}`
    : '';

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
   - REJECT articles that are just "2025 outlook" or "2030 projections" without recent news
   - REJECT articles clearly outside the 7-day window unless they provide critical context

3. CONTENT RELEVANCE AND IMPORTANCE:
   - Select articles with strategic implications and directional indicators
   - Select articles with shocking/first-time developments ("for the first time ever", "unprecedented", "historic reversal")
   - Select articles that reveal company power/position (not just news events)
   - Select articles with competitive dynamics and market positioning insights
   - Select articles with regulatory/political impacts that show company strength
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

  log(`Batched Triage: Selected ${res.object.selectedUrls.length} articles from ${uniqueResults.length} unique results (${results.length} total before dedup)`);
  log(`Triage reasoning: ${res.object.reasoning}`);

  return res.object.selectedUrls;
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

  log(`Smart Filter: ${toScrape.length} to scrape, ${metadataOnly.length} metadata-only`);
  if (toScrape.length > 0) {
    log(`  Scraping: ${toScrape.map(s => s.url.split('/').pop()).join(', ')}`);
  }
  if (metadataOnly.length > 0) {
    log(`  Metadata-only: ${metadataOnly.map(m => m.url.split('/').pop()).join(', ')}`);
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

  log(`Batched Smart Filter: ${toScrape.length} to scrape, ${metadataOnly.length} metadata-only`);
  if (toScrape.length > 0) {
    log(`  Scraping: ${toScrape.map(s => s.url.split('/').pop()).join(', ')}`);
  }
  if (metadataOnly.length > 0) {
    log(`  Metadata-only: ${metadataOnly.map(m => m.url.split('/').pop()).join(', ')}`);
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
  log(`Ran ${query}, found ${contents.length} contents`);

  const isCommodityQuery = /\b(oil|energy|gas|crude|commodit|natural gas|LNG|petroleum|OPEC|WTI|Brent)\b/i.test(query);
  const isCompanyQuery = /\b(NVIDIA|AAPL|MSFT|GOOGL|JPM|XOM|Exxon|company|earnings|stock)\b/i.test(query);
  
  const res = await generateObject({
    model: getModel(),
    abortSignal: AbortSignal.timeout(60_000),
    system: systemPrompt(),
    prompt: trimPrompt(
      `Given the following contents from a SERP search for the query <query>${query}</query>, generate a list of learnings from the contents. Return a maximum of ${numLearnings} learnings, but feel free to return less if the contents are clear. Make sure each learning is unique and not similar to each other. The learnings should be concise and to the point, as detailed and information dense as possible. Make sure to include any entities like people, places, companies, products, things, etc in the learnings, as well as any exact metrics, numbers, or dates.

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
  log(`Created ${res.object.learnings.length} learnings`, res.object.learnings);

  return res.object;
}

export async function writeFinalReport({
  prompt,
  learnings,
  visitedUrls,
}: {
  prompt: string;
  learnings: string[];
  visitedUrls: string[];
}) {
  const learningsString = learnings
    .map(learning => `<learning>\n${learning}\n</learning>`)
    .join('\n');

  const res = await generateObject({
    model: getModel(),
    system: reportStylePrompt(),
    prompt: trimPrompt(
      `Write a final report using ALL the learnings below. Follow the Wealthy Rabbit style exactly - write as ONE SINGLE COHESIVE NARRATIVE that tells one complete story.

CRITICAL STRUCTURE REQUIREMENTS:
- Write as ONE CONTINUOUS FLOWING NARRATIVE - do NOT break into separate sections
- Do NOT use --- separators
- Do NOT create multiple headlines - use ONLY ONE headline after the opening
- Do NOT repeat "If you own [ASSET]..." multiple times
- Present all events sequentially in the SAME story: opening → ONE headline → first event → second event → third event → connection → what didn't change → investor implication → closing
- The entire report should read as ONE cohesive story from start to finish

STYLE REQUIREMENTS:
- Write as flowing narrative - tell one complete story, not separate cards
- Weave context, past events, and future implications naturally throughout
- Use simple language, explain jargon immediately
- Use ONE emoji headline format: "[EMOJI] [ASSET] This Week: [3-5 word essence]"
- Make it dramatic and engaging - tell a story, not list facts
- When writing about companies, explain what events reveal about company power/position naturally
- Include strategic implications and directional indicators woven throughout
- When there's drama, make it dramatic with strong language and punchy sentences

EXPLAIN UNFAMILIAR TERMS (CRITICAL):
- When first mentioning companies, products, technologies, or terms, IMMEDIATELY provide context
- Explain WHO: "Eli Lilly — one of the biggest pharmaceutical companies in the world"
- Explain WHAT: "NVIDIA's H200 AI chips — the company's most powerful AI processors"
- Explain WHY IT MATTERS: Why this product/company is significant and why we're talking about it
- Weave explanations naturally into the narrative, not as separate definitions
- Don't assume reader knows what companies/products are - always provide brief context when first mentioned
- Examples:
  * "NVIDIA teamed up with Eli Lilly — one of the biggest pharmaceutical companies in the world"
  * "NVIDIA's H200 AI chips — the company's most powerful AI processors, capable of [key capability]"
  * "BioNeMo (NVIDIA's AI platform for drug discovery)"

CRITICAL: Write as ONE SINGLE CONTINUOUS NARRATIVE. Do NOT create separate sections or cards. Flow from opening through all events to closing as one cohesive story. Always explain unfamiliar terms when first mentioned.

<prompt>${prompt}</prompt>\n\nHere are all the learnings from previous research:\n\n<learnings>\n${learningsString}\n</learnings>`,
    ),
    schema: z.object({
      reportMarkdown: z.string().describe('Final report on the topic in Markdown following Wealthy Rabbit style'),
    }),
  });

  // Append the visited URLs section to the report
  const urlsSection = `\n\n## Sources\n\n${visitedUrls.map(url => `- ${url}`).join('\n')}`;
  return res.object.reportMarkdown + urlsSection;
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

export async function deepResearch({
  query,
  breadth,
  depth,
  learnings = [],
  visitedUrls = [],
  onProgress,
}: {
  query: string;
  breadth: number;
  depth: number;
  learnings?: string[];
  visitedUrls?: string[];
  onProgress?: (progress: ResearchProgress) => void;
}): Promise<ResearchResult> {
  const progress: ResearchProgress = {
    currentDepth: depth,
    totalDepth: depth,
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

  reportProgress({
    totalQueries: serpQueries.length,
    currentQuery: serpQueries[0]?.query,
  });

  const limit = pLimit(ConcurrencyLimit);

  // Step 2: Gather ALL search results first (metadata only, no scraping)
  log(`\n🔍 Gathering search results from ${serpQueries.length} queries...`);
  const allSearchResults = await Promise.all(
    serpQueries.map(serpQuery =>
      limit(async () => {
        try {
          const searchResult = await retryFirecrawlSearch(
            () => firecrawl.search(serpQuery.query, {
              timeout: 15000,
              limit: 30, // Get more results to triage from
              // NO scrapeOptions - just get metadata (titles, descriptions, URLs)
            }),
            serpQuery.query
          );

          return {
            query: serpQuery.query,
            researchGoal: serpQuery.researchGoal,
            results: searchResult.data.map(item => ({
              url: item.url,
              title: (item as any).title || (item as any).metadata?.title,
              description: (item as any).description || (item as any).snippet,
              snippet: (item as any).snippet,
            })),
          };
        } catch (e: any) {
          if (e.message && e.message.includes('Timeout')) {
            log(`Timeout error running query: ${serpQuery.query}: `, e);
          } else {
            log(`Error running query: ${serpQuery.query}: `, e);
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
          snippet: article.snippet,
          sourceQueries: [searchResult.query],
          researchGoals: [searchResult.researchGoal],
        });
      }
    }
  }

  const allArticles = Array.from(urlMap.values());
  const totalBeforeDedup = allSearchResults.reduce((sum, r) => sum + r.results.length, 0);
  log(`📊 Gathered ${allArticles.length} unique articles from ${totalBeforeDedup} total results (${totalBeforeDedup - allArticles.length} duplicates removed)`);

  if (allArticles.length === 0) {
    log(`No articles found for any query`);
    return {
      learnings: [],
      visitedUrls: [],
    };
  }

  // Step 4: Batch triage - process all articles together
  log(`\n🔍 Batch triaging ${allArticles.length} articles...`);
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

  log(`✅ Triage: Selected ${triagedArticles.length} articles from ${allArticles.length} unique results`);

  if (triagedArticles.length === 0) {
    log(`No relevant articles selected after triage`);
    return {
      learnings: [],
      visitedUrls: [],
    };
  }

  // Step 5: Batch filter - decide scrape vs metadata (with story deduplication)
  log(`\n🔍 Batch filtering ${triagedArticles.length} triaged articles...`);
  const { toScrape, metadataOnly } = await filterScrapeNeedsBatched({
    query: query,
    triagedResults: triagedArticles,
    researchGoals: allResearchGoals,
  });

  log(`✅ Filter: ${toScrape.length} to scrape, ${metadataOnly.length} metadata-only`);

  // Step 6: Scrape all selected articles in parallel
  log(`\n📥 Scraping ${toScrape.length} articles...`);
  const scrapedResults = await Promise.all(
    toScrape.map(({ url }) =>
      retryFirecrawlSearch(
        async () => {
          // Firecrawl scrape method - try different possible method names
          if (typeof (firecrawl as any).scrapeUrl === 'function') {
            return await (firecrawl as any).scrapeUrl(url, { formats: ['markdown'] });
          } else if (typeof (firecrawl as any).scrape === 'function') {
            return await (firecrawl as any).scrape(url, { formats: ['markdown'] });
          } else {
            // Fallback: use search with scrapeOptions for single URL
            const result = await firecrawl.search(`site:${new URL(url).hostname} ${url}`, {
              limit: 1,
              scrapeOptions: { formats: ['markdown'] },
            });
            return result.data[0] || { url, markdown: '' };
          }
        },
        url
      )
    )
  );

  // Step 7: Combine scraped results + metadata-only into SearchResponse format
  const combinedResult: SearchResponse = {
    data: [
      // Scraped articles
      ...scrapedResults.map((scraped, index) => {
        const markdown = 
          scraped?.markdown || 
          scraped?.data?.markdown || 
          scraped?.content?.markdown || 
          (typeof scraped === 'string' ? scraped : '');
        return {
          url: toScrape[index].url,
          markdown: markdown,
        };
      }),
      // Metadata-only articles (create markdown from title/description)
      ...metadataOnly.map(meta => ({
        url: meta.url,
        markdown: `Title: ${meta.title || 'No title'}\n\nDescription: ${meta.description || meta.snippet || 'No description'}\n\n[Metadata only - not fully scraped. Reason: ${meta.reason}]`,
      })),
    ],
  };

  // Collect URLs from this iteration
  const newUrls = compact(combinedResult.data.map(item => item.url));
  const newBreadth = Math.ceil(breadth / 2);
  const newDepth = depth - 1;

  // Step 8: Process all results together (better context)
  log(`\n📝 Processing ${combinedResult.data.length} articles to extract learnings...`);
  const newLearnings = await processSerpResult({
    query: query, // Use original query for context
    result: combinedResult,
    numFollowUpQuestions: newBreadth,
  });

  const allLearnings = [...learnings, ...newLearnings.learnings];
  const allUrls = [...visitedUrls, ...newUrls];

  // Step 9: Recursive depth exploration
  if (newDepth > 0) {
    log(`\n🔍 Researching deeper, breadth: ${newBreadth}, depth: ${newDepth}`);

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
    });
  } else {
    reportProgress({
      currentDepth: 0,
      completedQueries: serpQueries.length,
    });

    log(`\n✅ Research complete! Collected ${allLearnings.length} learnings from ${allUrls.length} URLs`);
    return {
      learnings: allLearnings,
      visitedUrls: allUrls,
    };
  }
}
