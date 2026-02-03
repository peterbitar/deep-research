/**
 * Investor checkup API: friendly conversational checkup for a holding
 * (stocks, crypto, ETFs, commodities) using the guide frameworks.
 * Uses web search when OPENAI_KEY is set to pull current data.
 */

import OpenAI from 'openai';

import { generateText } from './ai/generate-with-cost-log';
import { getModel } from './ai/providers';
import { logLLMCostAsync } from './cost-logger';
import { getPriceDataForHolding, type PriceData } from './price-detection';

export type AssetType = 'stock' | 'crypto' | 'etf' | 'commodity';

export interface HoldingInput {
  symbol: string;
  type?: string;
  name?: string;
}

/** Optional context from the latest news brief (report cards) for this holding. */
export interface NewsBriefContext {
  opening: string;
  cards: Array<{ title: string; content: string }>;
  publishedDate?: string;
}

const STOCKS_GUIDE = `STOCKS — What I do

Your sections for stocks:
**Earnings, Growth, Margin** — Latest earnings (EPS, revenue, margins). YoY growth rates. Profitability trends.
**Guidance + Confidence** — Management guidance for next quarter/year. Analyst consensus. Confidence in outlook (raised/lowered guidance?).
**Valuation & Risk** — P/E ratio, price-to-book, PEG. Analyst ratings (upside/downside). Market sentiment. Any red flags (debt, dilution, competition)?
**Market Reaction** — Stock price change on earnings. Analyst upgrades/downgrades. Institutional buying/selling.
**Recent Developments** — List 2-3 positive developments and 2-3 negative developments from the past week/month. Separate with "Positive:" and "Negative:" labels.
**General Sentiment** — One sentence: Is the market feeling Bullish, Bearish, or Neutral about this stock right now? Why?

Data sources:
- Yahoo Finance – earnings reports, financial metrics, analyst ratings
- SEC EDGAR – 10-Q/10-K filings for detailed financials
- MarketWatch / Reuters – earnings analysis and management commentary
- Bloomberg / FactSet – institutional flows and analyst consensus

CRITICAL: ALWAYS cite specific numbers (EPS, revenue growth %, margins). NO generic statements like "The company showed strong growth." State actual metrics with sources.`;

const CRYPTO_GUIDE = `CRYPTO — What I do

Your sections for crypto:
**Activity + Developer Signals** — Network activity (daily transactions, active addresses). GitHub commits and developer updates. Upcoming upgrades or partnerships.
**Network Health & Narrative** — Transaction fees, block times, validator count. Is the network still relevant? Any security concerns or forks?
**Supply + Market Metrics** — Circulating vs max supply. Unlock schedules (if any). Price momentum, volume, institutional flows.
**Risks + Adoption** — Regulatory threats, competition from other projects. Real usage metrics vs hype. Whale movements.
**Recent Developments** — List 2-3 positive developments and 2-3 negative developments from the past week/month. Separate with "Positive:" and "Negative:" labels.
**General Sentiment** — One sentence: Is the market feeling Bullish, Bearish, or Neutral about this crypto right now? Why?

Data sources:
- CoinGecko / Messari – live prices, market data, fund flows
- Glassnode – on-chain metrics (daily transactions, active addresses, whale wallets)
- The Block – industry research and flows
- GitHub – actual developer commits and activity
- CryptoSlate – project updates and news

CRITICAL: Include REAL on-chain data (daily transactions, active addresses, whale wallets). NO vague statements like "Bitcoin is decentralized." Always cite actual metrics with sources.`;

const ETF_GUIDE = `ETFs — What I do

Your sections for ETFs:
**Holdings & Theme** — What does this ETF actually own right now? Top 5 holdings + sector allocation. Has the composition changed?
**Performance & Benchmark** — How is it performing vs its benchmark/peers? Is it lagging or leading?
**Costs & Flows** — Expense ratio, management fees, investor inflows/outflows. Are costs rising?
**Market & Risks** — Current price, YTD performance, fund-specific risks (theme decay, concentration).
**Recent Developments** — List 2-3 positive developments and 2-3 negative developments from the past week/month. Separate with "Positive:" and "Negative:" labels.
**General Sentiment** — One sentence: Is the market feeling Bullish, Bearish, or Neutral about this ETF right now? Why?

Data sources:
- ETF.com – detailed holdings and drift tracking
- Morningstar – performance vs peers and category averages
- Yahoo Finance – top holdings and sector breakdown
- SEC filings – updated quarterly holdings

CRITICAL: Do NOT use generic statements like "ETFs provide diversified exposure." Instead, cite ACTUAL holdings, REAL percentages, and CURRENT performance numbers.`;

const COMMODITIES_GUIDE = `COMMODITIES — What I do

Your sections for commodities:
**Supply News** — Mining production, output changes, new discoveries or shutdowns. OPEC decisions (for oil). Agricultural harvest reports (for crops).
**Demand Outlook** — Growth in key markets (China, EM). Industrial demand trends. Seasonal demand patterns.
**Inventory & Macro** — Storage levels, strategic reserves, USD strength, real interest rates. Are inventories rising (bearish) or falling (bullish)?
**Price + Momentum** — Recent price moves, technical levels, institutional positioning. Geopolitical risks?
**Recent Developments** — List 2-3 positive developments and 2-3 negative developments from the past week/month. Separate with "Positive:" and "Negative:" labels.
**General Sentiment** — One sentence: Is the market feeling Bullish, Bearish, or Neutral about this commodity right now? Why?

Data sources:
- US EIA (Energy Info Admin) – oil, gas production and inventory
- USDA – commodity supply/demand reports
- Trading Economics / Investing.com – macro data (rates, USD, yields)
- Reuters / Bloomberg – supply disruption news, OPEC announcements
- LME / COMEX – inventory data and technical levels

CRITICAL: Include REAL supply/demand data (production figures, inventory levels, seasonal trends). NO vague statements like "Demand is strong." Always cite actual numbers with sources.`;

const ASSET_GUIDES: Record<AssetType, string> = {
  stock: STOCKS_GUIDE,
  crypto: CRYPTO_GUIDE,
  etf: ETF_GUIDE,
  commodity: COMMODITIES_GUIDE,
};

/** Commodity-backed ETFs: use commodities news (silver, gold, oil, etc.) not generic ETF news. */
const COMMODITY_BACKED_ETFS = new Set([
  'SLV', 'GLD', 'GLDM', 'IAUM', 'SLVP',  // silver, gold
  'USO', 'UNG', 'BNO', 'USL',             // oil, natural gas
  'PALL', 'PPLT', 'CPER', 'DBA', 'DBC',  // palladium, platinum, copper, ag, broad commodities
  'WEAT', 'CORN', 'SOYB', 'CANE', 'JO',  // grains/softs
  'PDBC', 'COMT', 'GSG', 'USCI',         // broad commodity ETFs
]);

/** Map user-provided type (or symbol hints) to AssetType. */
export function normalizeAssetType(symbol: string, type?: string): AssetType {
  const t = (type || '').toLowerCase().trim();
  const sym = symbol.toUpperCase();

  if (t.includes('crypto') || t === 'cryptocurrency' || /^(BTC|ETH|SOL|AVAX|DOGE|XRP|ADA|DOT|MATIC|LINK|UNI|ATOM|LTC|BCH|NEAR|ARB|OP|SUI|APT|INJ|TIA|SEI|PEPE|WIF|BONK|SHIB)$/i.test(sym)) {
    return 'crypto';
  }
  if (t.includes('commodity') || t.includes('commodities') || /^(GC|SI|CL|NG|HG|PL|PA|ZC|ZW|COPPER|GOLD|SILVER|OIL|GAS)$/i.test(sym)) {
    return 'commodity';
  }
  if (COMMODITY_BACKED_ETFS.has(sym)) return 'commodity';
  if (t.includes('etf') || t === 'etf') return 'etf';
  return 'stock';
}

const SYSTEM_PROMPT = `You are a critical, fact-based market analyst. The user tapped a button to get an honest checkup on a holding. Your job is to search TIER 1 sources for CURRENT news and write a checkup that reflects market reality—including negative developments that others might miss.

CRITICAL: You MUST do multiple web searches (at least 3-4 different queries per section). Find and report BOTH positive AND negative developments. Do not miss negative news or downplay it. Do not write generic statements or guesses.

What you must do:
1. **SEARCH STRATEGY** (This is the core of what makes a good checkup):
   - Run the search queries provided. They are optimized to find recent, relevant news.
   - PREFER tier 1 sources: Reuters, Bloomberg, CNBC, WSJ, SEC filings, official company/regulatory documents.
   - REJECT: obvious secondary sources like blogs, YouTube, crypto Twitter accounts, unverified forums.
   - If you find credible news from reputable financial sources, use it (prefer tier 1, but OK if credible).
   - Search for BOTH positive and negative news. If you find more negative news, report more negatives.
   - Example: If you find BTC regulatory threats from Reuters or Bloomberg, it MUST appear in Recent Developments

2. **Output format (CRITICAL)**: NO EMOJIS. Equal spacing throughout:
   - TWO blank lines BEFORE each header, TWO blank lines AFTER each paragraph/section.
   - Format: "\n\n\n**Header Name**\n\nContent text...\n\n\n**Next Header**"
   - Consistent spacing: TWO blank lines separate all sections and paragraphs.
   - Headers on own line, content on next lines, then TWO blank lines before next section.
   - ALWAYS include these sections:
     - **Recent Developments** (Latest positive and negative news/changes)
     - **General Sentiment** (Bullish, Bearish, or Neutral - with 1 sentence explaining why)
   - NEVER use emojis. NEVER run section headers together with content text.

3. **Price handling**: When "Reference price" is given, use ONLY that for price/%. Do not use prices from web search. The reference price is your source of truth for numbers.

4. **NO SOURCES IN OUTPUT**: Do NOT include source names, parenthetical citations (e.g. "(Reuters)"), inline links, or "Sources:" sections in the checkup text. Write the facts only; the reader will not see citations.

5. **ACTIVELY SEARCH FOR NEGATIVE NEWS** (CRITICAL):
   - Do NOT just report what you find. ACTIVELY search for downsides, risks, and criticism.
   - Search for: "regulatory crackdown," "underperformance," "competition threat," "warning," "downgrade," "crash," "breach"
   - Prioritize Reuters, Bloomberg, CNBC, WSJ, MarketWatch, SEC filings in your searches.
   - If you find negative news from credible financial sources, REPORT IT clearly. Do not downplay it or bury it in text.
   - Example: If BTC faces regulatory threats from Reuters/Bloomberg, it MUST appear in Recent Developments and affect sentiment.
   - Do NOT use CryptoNews, blogs, or unverified sources as primary facts. Use them only for context if corroborated by tier 1 sources.

6. **NO GENERIC FILLER**: Never write:
   - "Bitcoin's price fluctuations are influenced by various factors..."
   - "Recent data indicates..."
   - "No significant changes..." (if you can't find info, say "Limited recent reporting on...")
   Do only state REAL facts from your searches. If a section has no real data, say "Limited current reporting" and move on.

7. **Accuracy**: Only state facts you actually found. Prioritize TIER 1 sources in your research (Reuters, Bloomberg, CNBC, WSJ, MarketWatch, SEC). Do not output source names or links in the checkup text.

8. **Recent Developments** (CRITICAL) — NO OUTDATED NEWS:
   - Search ONLY for THIS WEEK, THIS MONTH, and current year. Do NOT surface old news as if it is current.
   - **All-time high / record high (CRITICAL)**: You MUST run a search for the LATEST record high (e.g. "[asset] all-time high [current month] [current year]"). Report ONLY that most recent ATH and its date. NEVER report a past month's high (e.g. December 2025) as the all-time high when the current date is later—readers will assume it's current. If the latest ATH you find is from an earlier month, either say "As of [that date], the record was $X; check live data for any newer high" or find a newer figure. Do not default to December or any old month.
   - List 2-3 POSITIVE recent developments (e.g., earnings beat, partnership, upgrade, good news, new records)
   - List 2-3 NEGATIVE recent developments (e.g., earnings miss, downgrade, regulatory issue, security breach, bad news)
   - If there are MORE negative developments than positive, list MORE negatives. Do NOT fake positive news to balance it.
   - Format: "Positive: [dev 1], [dev 2]. Negative: [dev 1], [dev 2], [dev 3]." (adapt based on what you find)

9. **General Sentiment** (CRITICAL) — Explain the feeling, do not compare to stocks:
   - State clearly what the feeling is about this asset right now: BULLISH, BEARISH, or NEUTRAL, and why in one sentence.
   - Do NOT write "commodities are not the same as stocks" or "silver/ gold/ X is different from equities." Just explain the current sentiment (e.g. "Cautious: volatility and Goldman's warning dominate." or "Bullish: record highs and strong demand.").
   - If negative developments outweigh positive, sentiment should reflect that. Do NOT default to optimism. Let the facts dictate the sentiment.

10. **Tone**: Direct, factual, and honest. Focus on REAL recent news, not generic statements. No outdated news; no "same as stocks" disclaimers.`;

/** Remove raw search snippets and source citations from checkup text. */
function sanitizeCheckupOutput(text: string): string {
  let out = text;
  // Remove "## Stock market information for ..." and everything until we hit an emoji section (🧠 ✅ etc.) or **
  const stockInfoMatch = out.match(/##\s*Stock market information[\s\S]*?(?=\n\s*[🧠✅🔮⚠️📉🪙🧱🎯💸🔄⚙️📦📈]|\n\s*\*\*|$)/i);
  if (stockInfoMatch) out = out.replace(stockInfoMatch[0], '');
  // Remove lines like "Bitcoin is a crypto in the CRYPTO market" or "X is an equity in the USA market"
  out = out.replace(/\n[^\n]*\s+is\s+a\s+(?:crypto|equity)\s+in\s+the\s+[A-Z]+\s+market[^\n]*/gi, '');
  // Remove bullet lines that are clearly raw search (price, intraday, latest open/trade)
  out = out.replace(/\n\s*-\s*(?:The price is|The intraday|The latest (?:open|trade))[^\n]*/gi, '');
  // Strip source citations: markdown links [Text](url) -> Text, parenthetical (SourceName), trailing · source.com
  out = out.replace(/\[([^\]]+)\]\(https?:\/\/[^)]+\)/g, '$1');
  out = out.replace(/\s*\([^)]*(?:\.com|\.net|\.org|Reuters|Bloomberg|CNBC|WSJ|MarketWatch|CoinGecko|TheBlock|Benzinga|Red94)[^)]*\)/gi, '');
  out = out.replace(/\s*[·•]\s*[a-z0-9.-]+\.[a-z]{2,}\s*/gi, ' ');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function formatReferencePrice(p: PriceData): string {
  const priceStr =
    p.currentPrice >= 1
      ? p.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.currentPrice.toFixed(4);
  let oneDay = '';
  if (p.changePercent1d != null) {
    const pct1d = Math.abs(p.changePercent1d).toFixed(1);
    const dir1d = pct1d === '0.0' ? 'flat' : (p.changePercent1d >= 0 ? 'up' : 'down');
    oneDay = `, ${dir1d} ${pct1d === '0.0' ? '' : pct1d + '% '}(1d)`.replace('  ', ' ');
  }
  return `${p.symbol}: $${priceStr}${oneDay}`;
}

/** Build a single correct sentence for the Market section from reference price (so we never show wrong numbers). */
function marketSentenceFromPrice(p: PriceData): string {
  const priceStr =
    p.currentPrice >= 1
      ? p.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.currentPrice.toFixed(4);
  let oneDay = '';
  if (p.changePercent1d != null) {
    const pct1d = Math.abs(p.changePercent1d).toFixed(1);
    const dir1d = pct1d === '0.0' ? 'flat' : (p.changePercent1d >= 0 ? 'up' : 'down');
    oneDay = pct1d === '0.0' ? ' and flat in the last 24 hours' : ` and ${dir1d} ${pct1d}% in the last 24 hours`;
  }
  return `Trading at $${priceStr}${oneDay}.`;
}

const WEB_SEARCH_TOOL = { type: 'web_search_preview' as const, search_context_size: 'high' as const };

function extractOutputText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = response.output;
  if (!Array.isArray(output)) return '';

  const parts: string[] = [];
  for (const item of output) {
    const msg = item as {
      type?: string;
      content?: Array<{ type?: string; text?: string }>;
    };
    if (msg.type !== 'message' || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === 'output_text' && typeof block.text === 'string') {
        parts.push(block.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function extractUrlsFromResponse(response: OpenAI.Responses.Response): string[] {
  const urls: string[] = [];
  const output = response.output;
  if (!Array.isArray(output)) return urls;

  for (const item of output) {
    const msg = item as any;

    // Check for citations in the response structure
    if (msg.citations && Array.isArray(msg.citations)) {
      for (const citation of msg.citations) {
        if (citation.url && typeof citation.url === 'string') {
          urls.push(citation.url);
        }
      }
    }

    // Also check content blocks for citations
    if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === 'citation' && block.url) urls.push(block.url);
        if (block.type === 'output_text' && block.url) urls.push(block.url);
        if (block.citation?.url) urls.push(block.citation.url);
      }
    }
  }
  return [...new Set(urls)];
}

/**
 * Run checkup with OpenAI Responses API + web search to get current data.
 */
async function runCheckupWithWebSearch(
  systemPrompt: string,
  userPrompt: string
): Promise<{ text: string; urls: string[] } | null> {
  const apiKey = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.log('[Holding checkup] Skipping web search (no OPENAI_KEY). Using fallback.');
    return null;
  }

  const client = new OpenAI({ apiKey });
  const model = process.env.CHECKUP_MODEL ?? process.env.CHAT_MODEL ?? 'gpt-4o-mini';

  const maxCompletionTokens = (() => {
    const raw = process.env.OPENAI_MAX_COMPLETION_TOKENS?.trim();
    if (!raw) return undefined;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n >= 1 ? n : undefined;
  })();

  console.log('[Holding checkup] Using web search (OPENAI_KEY set).');
  const response = await client.responses.create({
    model,
    instructions: systemPrompt,
    input: [{ type: 'message', role: 'user', content: userPrompt }],
    tools: [WEB_SEARCH_TOOL],
    tool_choice: 'auto', // Let the model decide to use web search when needed
    ...(maxCompletionTokens != null && { max_output_tokens: maxCompletionTokens }),
  });

  const usage = response.usage;
  const inputTokens = usage?.input_tokens ?? 0;
  const outputTokens = usage?.output_tokens ?? 0;
  if (usage && (inputTokens > 0 || outputTokens > 0)) {
    logLLMCostAsync({
      modelId: model,
      inputTokens,
      outputTokens,
      operation: 'holding-checkup',
    });
  }

  const text = extractOutputText(response);
  let urls = extractUrlsFromResponse(response);

  // Also extract URLs from markdown links in the output text [text](url)
  const markdownLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
  let match;
  while ((match = markdownLinkRegex.exec(text)) !== null) {
    if (match[2] && match[2].startsWith('http')) {
      urls.push(match[2]);
    }
  }

  // Extract URLs from plain text citations like (source.com) or (domain.com)
  const citationRegex = /\(([a-z0-9\-]+(?:\.[a-z0-9\-]+)+(?:\/[^\s)]*)?)\)/g;
  while ((match = citationRegex.exec(text)) !== null) {
    const potential = match[1];
    // Only add if it looks like a domain (has a dot and at least 2 parts)
    if (potential.includes('.') && !potential.startsWith('http')) {
      urls.push(`https://${potential.split('/')[0]}`); // Use just the domain part
    }
  }

  urls = [...new Set(urls)]; // Deduplicate
  console.log(`[Holding checkup] Web search returned ${urls.length} citation URL(s).`);
  return { text, urls };
}

/**
 * Generate a friendly conversational investor checkup for the given holding.
 * Uses web search (when OPENAI_KEY is set) to pull current data; otherwise falls back to model knowledge + optional news brief.
 */
export async function generateHoldingCheckup(
  holding: HoldingInput,
  options?: { newsBriefContext?: NewsBriefContext }
): Promise<{
  checkup: string;
  assetType: AssetType;
  citationUrls?: string[];
  webSearchUsed?: boolean;
}> {
  const { symbol, name } = holding;
  const assetType = normalizeAssetType(symbol, holding.type);
  const guide = ASSET_GUIDES[assetType];
  const label = name || symbol;

  const priceData = await getPriceDataForHolding(symbol);

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.toLocaleString('en-US', { month: 'long' });
  const dateLabel = now.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const searchQueries =
    assetType === 'stock'
      ? [
          `${symbol} ${label} earnings Q1 2026 Bloomberg Reuters CNBC`,
          `${symbol} stock downgrade warning analyst 2026`,
          `${label} valuation P/E risk February 2026`,
          `${symbol} negative outlook earnings miss 2026`,
        ]
      : assetType === 'crypto'
        ? [
            `${symbol} ${label} regulatory news February 2026 Reuters Bloomberg`,
            `${symbol} security threat hack exploit 2026`,
            `${label} bearish news risks competition 2026`,
            `${symbol} price decline crash news this week`,
            `${label} developer activity updates February 2026`,
          ]
        : assetType === 'etf'
          ? [
              `${symbol} ${label} price record high February 2026 this week`,
              `${symbol} ETF latest news ${currentMonth} 2026`,
              `${label} recent developments January February 2026`,
              `${symbol} performance vs benchmark 2026`,
            ]
          : [
              `${label} all-time high record high ${currentMonth} ${currentYear}`,
              `${label} price record high ${currentMonth} ${currentYear} latest`,
              `${label} commodity latest news this week ${currentYear}`,
              `${label} recent price action ${currentMonth} ${currentYear} trading`,
              `${label} supply demand news ${currentMonth} ${currentYear}`,
            ];

  const searchHints = `DO THIS NOW: Run these specific web searches (not suggestions, these are your task):
${searchQueries.map((q, i) => `${i + 1}. "${q}"`).join('\n')}

TIER 1 SOURCES ONLY (reject everything else):
${
    assetType === 'stock'
      ? 'Reuters (reuters.com), Bloomberg (bloomberg.com), CNBC (cnbc.com), Wall Street Journal (wsj.com), SEC EDGAR (sec.gov), MarketWatch (marketwatch.com)'
      : assetType === 'crypto'
        ? 'Reuters (reuters.com), Bloomberg (bloomberg.com), CNBC (cnbc.com), SEC (sec.gov), FinCEN, regulatory agency warnings ONLY. NO crypto blogs, no unverified sources.'
        : assetType === 'etf'
          ? 'Bloomberg (bloomberg.com), Reuters (reuters.com), SEC filings (sec.gov), Morningstar (morningstar.com), CNBC (cnbc.com)'
          : 'Reuters (reuters.com), Bloomberg (bloomberg.com), CNBC (cnbc.com), U.S. EIA (eia.gov), USDA (usda.gov), Federal Reserve statements'
  }

DO NOT USE: etf.com, investing.com, stockanalysis.com, CoinGecko, Messari, crypto forums, YouTube, blogs, or unverified sources.

Fill each section with facts from YOUR searches, not generic knowledge. Do not include source names or citations in the output.`;

  let prompt = `Today: ${dateLabel} (${currentMonth} ${currentYear}). Give a short checkup for **${label}** (${symbol}) using the guide below.

IMPORTANT — Do NOT add intro text like "As of Feb 3, SLV is trading at $XX". Jump straight to the first section header. The price will be added separately at the end.

IMPORTANT — Recency: Search for news from ${currentMonth} ${currentYear} or "this week" only. Do NOT give outdated news: if the only ATH you find is from December 2025, do not present it as the all-time high without saying it was December 2025 and that the reader should check for a newer high. Run the "[asset] all-time high ${currentMonth} ${currentYear}" query and use the most recent result. Prefer the newest results for every section.

Use web search. Fill each section with what you find. Do not output source names or citations.`;

  if (priceData) {
    const priceLine = formatReferencePrice(priceData);
    prompt += `

Reference price (use this in the 📉 Market + liquidity section — write 1–2 sentences with this price and these % moves):
${priceLine}

The 📉 section must include the price (and 1d % from the line above if present). Do not say "No recent data" for 📉 when you have this.`;
  }

  prompt += `

${searchHints}

Output: one intro sentence, then the emoji sections from the guide with 1–2 sentences each. End with one sentence: healthy or warning sign.

${guide}`;

  if (options?.newsBriefContext?.cards?.length) {
    const { opening, cards, publishedDate } = options.newsBriefContext;
    const cardBlobs = cards.map((c) => `• ${c.title}\n  ${c.content}`).join('\n\n');
    prompt += `

Use this recent news brief context when relevant (cite "from our latest brief" when you use it):
${publishedDate ? `(Published: ${publishedDate})\n\n` : ''}
Opening: ${opening}

Cards relevant to ${symbol}:
${cardBlobs}

Weave the above into the emoji sections where it fits. Keep the tone friendly and the structure (emoji headers + 1–2 sentences each).`;
  }

  const webResult = await runCheckupWithWebSearch(SYSTEM_PROMPT, prompt);
  if (webResult && webResult.text.trim()) {
    let checkup = sanitizeCheckupOutput(webResult.text.trim());
    if (priceData) checkup = ensurePriceInCheckup(checkup, priceData);
    return {
      checkup,
      assetType,
      webSearchUsed: true,
      ...(webResult.urls.length > 0 && { citationUrls: webResult.urls }),
    };
  }

  console.log('[Holding checkup] Using fallback (generateText, no web search).');
  const result = await generateText({
    model: getModel(),
    system: SYSTEM_PROMPT,
    prompt,
    maxTokens: 600,
    operation: 'holding-checkup',
  });

  let checkup = sanitizeCheckupOutput(result.text.trim());
  if (priceData) checkup = ensurePriceInCheckup(checkup, priceData);
  return {
    checkup,
    assetType,
    webSearchUsed: false,
  };
}

/** Replace the 📉 Market + liquidity section content with one correct sentence from reference price (avoids wrong numbers from web search). */
function replaceMarketSectionWithReferencePrice(checkup: string, p: PriceData): string {
  const correctSentence = marketSentenceFromPrice(p);
  const marketHeader = /(📉\s*\*\*Market \+ liquidity\*\*[^\n]*)/i;
  const match = checkup.match(marketHeader);
  if (!match) return checkup;
  const afterHeader = checkup.indexOf(match[1]) + match[1].length;
  const tail = checkup.slice(afterHeader);
  const nextSection = tail.search(/\n\s*[🧠✅🔮⚠️🪙🧱🎯💸🔄⚙️📦📈]\s*\*\*/);
  const rest = nextSection >= 0 ? tail.slice(nextSection) : '';
  const before = checkup.slice(0, afterHeader);
  return `${before}\n\n${correctSentence}\n${rest}`.replace(/\n{3,}/g, '\n\n').trim();
}

/** If the intro line contains a price or %, replace it with a correct intro using reference price only. */
function fixIntroPrice(checkup: string, p: PriceData): string {
  const lines = checkup.split(/\n/);
  if (lines.length === 0) return checkup;
  const first = lines[0];
  if (!/\$|%|percent|trading at|price/i.test(first)) return checkup;
  const priceStr =
    p.currentPrice >= 1
      ? p.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.currentPrice.toFixed(4);
  const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const intro = `As of ${date}, ${p.symbol} is ${marketSentenceFromPrice(p).replace(/^Trading at /, 'trading at ')}`;
  lines[0] = intro;
  return lines.join('\n');
}

/** Ensure all price and % in the checkup come from reference data: fix intro and 📉 section, then append price line. */
function ensurePriceInCheckup(checkup: string, p: PriceData): string {
  let out = fixIntroPrice(checkup, p);
  out = replaceMarketSectionWithReferencePrice(out, p);
  const priceLine = formatReferencePrice(p);
  if (out.includes('Price (as of checkup)')) return out;
  return `${out}\n\n**Price (as of checkup):** ${priceLine}`;
}
