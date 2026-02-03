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

/** Map user-provided type (or symbol hints) to AssetType. */
export function normalizeAssetType(symbol: string, type?: string): AssetType {
  const t = (type || '').toLowerCase().trim();
  const sym = symbol.toUpperCase();

  if (t.includes('crypto') || t === 'cryptocurrency' || /^(BTC|ETH|SOL|AVAX|DOGE|XRP|ADA|DOT|MATIC|LINK|UNI|ATOM|LTC|BCH|NEAR|ARB|OP|SUI|APT|INJ|TIA|SEI|PEPE|WIF|BONK|SHIB)$/i.test(sym)) {
    return 'crypto';
  }
  if (t.includes('etf') || t === 'etf') return 'etf';
  if (t.includes('commodity') || t.includes('commodities') || /^(GC|SI|CL|NG|HG|PL|PA|ZC|ZW|COPPER|GOLD|SILVER|OIL|GAS)$/i.test(sym)) {
    return 'commodity';
  }
  return 'stock';
}

const SYSTEM_PROMPT = `You are a friendly investing buddy. The user tapped a button to get a quick checkup on a holding. Your job is to search the web for CURRENT, SPECIFIC information and write a short checkup based on REAL data you find.

CRITICAL: You MUST do multiple web searches (at least 3-4 different queries per section) to fill each emoji section with REAL, RECENT facts. Do not write generic statements or guesses.

What you must do:
1. **SEARCH STRATEGY** (This is the core of what makes a good checkup):
   - Do NOT just search once. Run 3-4 targeted searches per asset type.
   - Each search query MUST include current month/year or "latest" or "this week"
   - Search from multiple angles: recent price action, fundamental news, technical moves, sentiment
   - Example for crypto: "BTC network activity February 2026", "Bitcoin developer commits latest", "BTC price news this week", "Ethereum vs Bitcoin February 2026"
   - Do NOT cite generic market knowledge; only cite facts from your search results

2. **Output format (CRITICAL)**: NO EMOJIS. Use clear section headers with proper newlines:
   - Start EACH section on a new line with **bold title**, e.g.: "\n\n**Earnings, Growth, Margin**\n"
   - Under each header, write 1–2 sentences of REAL facts with citations.
   - ALWAYS put section header on its own line, separated from content.
   - ALWAYS include these sections:
     - **Recent Developments** (Latest positive and negative news/changes, bullet points)
     - **General Sentiment** (Bullish, Bearish, or Neutral - with 1 sentence explaining why)
   - NEVER use emojis. NEVER run section headers together with content text.

3. **Price handling**: When "Reference price" is given, use ONLY that for price/%. Do not use prices from web search. The reference price is your source of truth for numbers.

4. **Citations**: After every factual claim, cite the source (e.g., "(CoinGecko)", "(TheBlock)"). If you found it in web search, cite it.

5. **NO GENERIC FILLER**: Never write:
   - "Bitcoin's price fluctuations are influenced by various factors..."
   - "Recent data indicates..."
   - "No significant changes..." (if you can't find info, say "Limited recent reporting on...")
   Do only state REAL facts from your searches. If a section has no real data, say "Limited current reporting" and move on.

8. **Citation format**: Place links inline like: "text ([Source Name](https://url))" in markdown format. Make citations clickable for the user.

6. **Accuracy**: Only state facts you actually found in web search results. Do not guess or invent data.

7. **Recent Developments** (CRITICAL):
   - Search for news from THIS WEEK or THIS MONTH only
   - List 2-3 POSITIVE recent developments (e.g., earnings beat, partnership, upgrade, good news)
   - List 2-3 NEGATIVE recent developments (e.g., earnings miss, downgrade, regulatory issue, bad news)
   - Format: "Positive: [dev 1], [dev 2], [dev 3]. Negative: [dev 1], [dev 2], [dev 3]."

8. **General Sentiment** (CRITICAL):
   - After all facts, decide: Is the overall market sentiment BULLISH, BEARISH, or NEUTRAL right now?
   - Write ONE sentence explaining the sentiment (e.g., "Bullish: Strong earnings and analyst upgrades offset valuation concerns.")
   - Base this on the facts you found, not generic statements

9. **Tone**: Warm and conversational. Focus on REAL recent news, not generic statements.`;

/** Remove raw search snippets that the model sometimes pastes (e.g. "Stock market information", "X is a crypto in the CRYPTO market"). */
function sanitizeCheckupOutput(text: string): string {
  let out = text;
  // Remove "## Stock market information for ..." and everything until we hit an emoji section (🧠 ✅ etc.) or **
  const stockInfoMatch = out.match(/##\s*Stock market information[\s\S]*?(?=\n\s*[🧠✅🔮⚠️📉🪙🧱🎯💸🔄⚙️📦📈]|\n\s*\*\*|$)/i);
  if (stockInfoMatch) out = out.replace(stockInfoMatch[0], '');
  // Remove lines like "Bitcoin is a crypto in the CRYPTO market" or "X is an equity in the USA market"
  out = out.replace(/\n[^\n]*\s+is\s+a\s+(?:crypto|equity)\s+in\s+the\s+[A-Z]+\s+market[^\n]*/gi, '');
  // Remove bullet lines that are clearly raw search (price, intraday, latest open/trade)
  out = out.replace(/\n\s*-\s*(?:The price is|The intraday|The latest (?:open|trade))[^\n]*/gi, '');
  out = out.replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function formatReferencePrice(p: PriceData): string {
  const priceStr =
    p.currentPrice >= 1
      ? p.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.currentPrice.toFixed(4);
  const dir7 = p.changePercent >= 0 ? 'up' : 'down';
  const pct7 = Math.abs(p.changePercent).toFixed(1);
  const sevenDay = `${dir7} ${pct7}% (7d)`;
  const oneDay =
    p.changePercent1d != null
      ? `, ${p.changePercent1d >= 0 ? 'up' : 'down'} ${Math.abs(p.changePercent1d).toFixed(1)}% (1d)`
      : '';
  return `${p.symbol}: $${priceStr}, ${sevenDay}${oneDay}`;
}

/** Build a single correct sentence for the Market section from reference price (so we never show wrong numbers). */
function marketSentenceFromPrice(p: PriceData): string {
  const priceStr =
    p.currentPrice >= 1
      ? p.currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : p.currentPrice.toFixed(4);
  const dir7 = p.changePercent >= 0 ? 'up' : 'down';
  const pct7 = Math.abs(p.changePercent).toFixed(1);
  const oneDay =
    p.changePercent1d != null
      ? `${p.changePercent1d >= 0 ? 'up' : 'down'} ${Math.abs(p.changePercent1d).toFixed(1)}% in the last 24 hours`
      : null;
  const weekPart = `${dir7} ${pct7}% over the past week`;
  return `Trading at $${priceStr}, ${weekPart}${oneDay ? ` and ${oneDay}` : ''}.`;
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
          `${symbol} ${label} earnings report Q4 2025 Q1 2026`,
          `${label} stock price action news this week ${currentMonth}`,
          `${symbol} earnings guidance analyst expectations 2026`,
          `${label} valuation P/E ratio analyst rating latest`,
        ]
      : assetType === 'crypto'
        ? [
            `${symbol} ${label} price movement news this week ${currentYear}`,
            `${label} network metrics on-chain activity latest`,
            `${symbol} whale transactions investor sentiment ${currentMonth}`,
            `${label} development roadmap updates 2026`,
          ]
        : assetType === 'etf'
          ? [
              `${symbol} ETF top holdings allocation ${currentMonth} ${currentYear}`,
              `${label} ETF inflows outflows ${currentMonth}`,
              `${symbol} vs benchmark performance YTD 2026`,
              `${label} ETF expense ratio fund flow trends latest`,
            ]
          : [
              `${label} commodity price ${currentMonth} ${currentYear}`,
              `${label} supply demand outlook this week`,
              `${label} geopolitical demand factors ${currentMonth} 2026`,
            ];

  const searchHints = `DO THIS NOW: Run these specific web searches (not suggestions, these are your task):
${searchQueries.map((q, i) => `${i + 1}. "${q}"`).join('\n')}

Use these sources: ${
    assetType === 'stock'
      ? 'Yahoo Finance, MarketWatch, Reuters, SEC filings, Bloomberg'
      : assetType === 'crypto'
        ? 'CoinGecko, Messari, The Block, CryptoSlate, Glassnode'
        : assetType === 'etf'
          ? 'ETF.com, Morningstar, Yahoo Finance'
          : 'Investing.com, Trading Economics, Reuters, OilPrice'
  }

After each search, cite what you find. Fill each emoji section with facts from YOUR searches, not generic knowledge.`;

  let prompt = `Today: ${dateLabel} (${currentMonth} ${currentYear}). Give a short checkup for **${label}** (${symbol}) using the guide below.

IMPORTANT — Recency: Search for news from ${currentMonth} ${currentYear} or "this week". Your search queries must include "${currentMonth} ${currentYear}" or "this week" or "latest" so you get recent articles, not old ones. Prefer the newest results for each section. If you only find older data (e.g. 2025), label it (e.g. "From 2025 data:" or "As of late 2025:") so the user knows it's not current.

Use web search. Fill each section with what you find; cite sources.`;

  if (priceData) {
    const priceLine = formatReferencePrice(priceData);
    prompt += `

Reference price (use this in the 📉 Market + liquidity section — write 1–2 sentences with this price and these % moves):
${priceLine}

The 📉 section must include the price and 7d/1d % from the line above. Do not say "No recent data" for 📉 when you have this.`;
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
