/**
 * News brief pipeline via OpenAI Responses API (web search).
 * Supports non-reasoning, agentic, and deep-research modes.
 * Does not modify the existing pipeline; produces learnings for writeFinalReport/saveReport.
 */

import OpenAI from 'openai';
import { generateAllQueries } from './news-brief-queries';
import type { PriceData } from './price-detection';

export type NewsBriefMode = 'non-reasoning' | 'agentic' | 'deep-research';

export interface HoldingEntry {
  symbol: string;
  type: string;
  name: string;
}

const MODE_CONFIG: Record<
  NewsBriefMode,
  { model: string; timeout?: number; background?: boolean }
> = {
  'non-reasoning': {
    model: 'gpt-4o-mini',
  },
  agentic: {
    model: 'gpt-4o',
  },
  'deep-research': {
    model: 'o4-mini-deep-research-2025-06-26',
    timeout: 300_000, // 5 min
  },
};

/** Web search tool type supported by the Responses API. */
const WEB_SEARCH_TOOL = { type: 'web_search_preview' as const };

/** Tags for triaging findings (blueprint). */
const TAGS =
  'structural price move | short-term panic | no change | earnings surprise | downgrade risk | ETF demand shift | macro pressure | macro tailwind | explains broader narrative';

const PASS_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Real-time search + verify market data',
  2: 'Scan news for drivers (internal)',
  3: 'Scan news for drivers (macro)',
};

/** 5-step workflow: interpret holdings → targeted queries → Tier 1 only → hard data + causes → structural ties. */
const WORKFLOW_STEPS = `
WORKFLOW (follow in sequence):
1. INTERPRET HOLDINGS — Crypto (BTC): technicals, liquidations, ETF flows, funding, macro correlation. Stocks: earnings, analyst notes, filings, product/partnership news. ETFs/commodities: price moves, macro drivers (dollar, rates).
2. RUN TARGETED QUERIES — Use the queries below. Run them for precision; do not collapse into one vague search.
3. TIER 1 SOURCES ONLY — Keep only: Bloomberg, Reuters, Financial Times, Yahoo Finance, TechCrunch, SEC, Coindesk, The Block, CryptoQuant (crypto), MarketWatch, etf.com, Morningstar. Discard: Reddit, unsourced Twitter, AI blogs, low-quality aggregators.
4. EXTRACT HARD DATA + CAUSES — For each finding: exact date, price level and % change, cause-and-effect (why it moved, not just what). Include macro drivers (rates, USD, Fed) where relevant. Example: "BTC dropped 8% to $78,000 on Jan 30. Cause: liquidations + funding rates turned negative. Source: Coinglass."
5. TIE TOGETHER STRUCTURALLY — Note connections: Did BTC move with tech stocks? (correlation.) Did silver fall harder than gold? (macro rotation.) Earnings beat but stock fell? (valuation/sentiment mismatch.) These become cards.

AUDIENCE — Write for someone not very financially literate. Keep the whole picture; stay conversational. Explain as if you're talking to a friend over coffee — no analyst jargon, no chart slang, no heavy technical detail. Lead with the story and why it matters, not with numbers or jargon.`;

/** Shared output style and format (used by single-pass and legacy full prompt). */
function outputStyleAndFormat(): string {
  return `
OUTPUT STYLE (required): Whole picture, conversational, as if talking to someone not very financially literate.
- WHOLE PICTURE. Focus on the big picture: what changed and why it matters. Do not go deep into technicals; keep it high-level and easy to follow.
- CONVERSATIONAL. Write like you're talking to a friend over coffee — clear, natural, no jargon, no corporate or analyst speak. If you mention a term (e.g. "ETF", "funding rate"), briefly explain in plain English or skip the term.
- NOT TOO TECHNICAL. Do not use analyst jargon, chart slang, or heavy financial detail (e.g. skip "support at 93.2k", "RSI divergence", "basis points"). One or two simple numbers (e.g. "down about 5%", "around $95k") are enough when they help the story.
- STORYLINE FIRST. Lead with the story and why it matters; mention price or % only when it helps. One or two numbers per bullet is enough.

OUTPUT:
- One bullet per finding. Include: exact date, price/ % when relevant, cause (why it moved), source. Macro: [explains/contradicts/neutral]. [Tag: <tag>]
- Format: "- [storyline]. Source, Date. Macro: [explains/contradicts/neutral]. [Tag: <tag>]"
- Example: "- BTC dropped 8% to $78,000 on Jan 30. Cause: liquidations + funding rates turned negative. Coinglass, Jan 30. Macro: risk-off, DXY up. [Tag: structural price move]"
- If no material change for a holding in this pass, output: "- No material change in the past 5–7 days for [ticker] in this pass. [Tag: no change]"
- List format only. No preamble or conclusion. Include ONLY past 5–7 days. Tier 1 sources only.`;
}

/** Format one reference price line for the prompt. */
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
      ? `${p.changePercent1d >= 0 ? 'up' : 'down'} ${Math.abs(p.changePercent1d).toFixed(1)}% (1d)`
      : '';
  return `${p.symbol}: $${priceStr}, ${sevenDay}${oneDay ? ', ' + oneDay : ''}`;
}

/**
 * Build a prompt for a single pass (1, 2, or 3). Used for 3 consecutive API calls.
 */
export function buildNewsBriefPromptForPass(
  holdings: HoldingEntry[],
  includeMacro: boolean,
  passNumber: 1 | 2 | 3,
  referencePrices?: Map<string, PriceData>
): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const grouped = generateAllQueries(holdings, includeMacro);
  const thisPassGroups = grouped.filter((g) => g.pass === passNumber);
  if (thisPassGroups.length === 0) {
    return '';
  }

  const hasCrypto = holdings.some((h) => h.type === 'Cryptocurrency' || h.symbol === 'BTC' || h.symbol === 'ETH');
  const passLabel = PASS_LABELS[passNumber];

  const referenceBlock =
    referencePrices && holdings.length > 0
      ? holdings
          .filter((h) => referencePrices.has(h.symbol.toUpperCase()))
          .map((h) => referencePrices.get(h.symbol.toUpperCase())!)
          .map(formatReferencePrice)
          .join('; ')
      : '';
  const referenceLine =
    referenceBlock.length > 0
      ? `\nREFERENCE PRICES (from Yahoo Finance; use these numbers — do not contradict): ${referenceBlock}. When mentioning price or % change for these symbols, use only these values.\n`
      : '';

  let prompt = `GOAL: "What changed this week, what didn't — and why that matters to a long-term investor."
Keep the whole picture. Write as if talking to someone not very financially literate: conversational, no jargon, big picture only — do not go too technical.

${WORKFLOW_STEPS}

This is PASS ${passNumber} of 3: ${passLabel}.

Use web search for the queries below. Only include developments from the past 5–7 days. Cite source and date. Use Tier 1 sources only (see Step 3). Extract hard data + cause (Step 4); note structural connections (Step 5). Express everything in plain, conversational English — no analyst or chart jargon.${hasCrypto && passNumber === 1 ? ' For crypto, prefer data up to the day or hour.' : ''}

STALE DATA — Only cite prices and facts from sources dated within the last 7 days of today (${dateStr}). If search returns 2023/2024 or older, ignore those price levels. If a price looks wrong for "this week" (e.g. Bitcoin at $28k when it has been far higher), do not output it.
${referenceLine}
Today's date: ${dateStr}. Holdings: ${holdings.map((h) => `${h.symbol} (${h.name})`).join('; ')}.

QUERIES FOR THIS PASS (run separately for precision; search in this order):
`;
  for (const { holding, pass, queries } of thisPassGroups) {
    const label = holding ? `${holding.symbol}: ${passLabel}` : `Macro / correlation: ${passLabel}`;
    prompt += `\n--- ${label} ---\n`;
    for (const q of queries) {
      prompt += `• ${q}\n`;
    }
  }

  if (passNumber === 1) {
    prompt += `
For each finding: what happened to price this week (up or down, in plain terms), and why — e.g. more selling, big outflows, liquidations. Keep it conversational; avoid chart jargon (support/resistance, RSI, etc.).`;
  } else if (passNumber === 2) {
    prompt += `
For each finding: what is driving the move (earnings, deals, regulation, flows, sentiment). Explain WHY in plain English, not just what. No jargon.`;
  } else {
    prompt += `
For each finding: how the big picture (Fed, dollar, rates, risk mood) explains or contradicts the move. Note if several assets moved together. Keep it conversational.`;
  }

  prompt += `

TAGGING — For each finding, assign ONE tag: ${TAGS}`;
  prompt += outputStyleAndFormat();
  return prompt;
}

/**
 * Build a structured prompt using 3-pass sequenced logic per holding (single prompt; legacy).
 * Prefer running 3 consecutive prompts via newsBriefOpenAI which calls buildNewsBriefPromptForPass(1), (2), (3).
 */
export function buildNewsBriefPrompt(
  holdings: HoldingEntry[],
  includeMacro: boolean
): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
  const grouped = generateAllQueries(holdings, includeMacro);

  const hasCrypto = holdings.some((h) => h.type === 'Cryptocurrency' || h.symbol === 'BTC' || h.symbol === 'ETH');
  let prompt = `GOAL: "What changed this week, what didn't — and why that matters to a long-term investor."
Find only real, structural developments: price broke a key level, macro sentiment shifted, earnings changed the outlook, regulation or liquidity flows moved positioning. Not just "news happened" — "investor logic changed."

THREE-STEP FACT GATHERING (do all three; use live search so info is fresh):

1. REAL-TIME SEARCH — Use live search to get the most current news, charts, and prices from trusted sources. For crypto and fast-moving assets, aim for data up to the day or even hour. Trusted sources: Bloomberg, CoinDesk, FXStreet, CoinGecko, Investopedia, Economic Times; also TradingView, Investing.com, Reuters, FT, WSJ, SEC, Coinglass, The Block, Glassnode, etf.com, Morningstar.

2. VERIFY MARKET DATA — For each holding, check and report: current price and weekly movement (up/down this week), key technical levels (support/resistance), analyst and trader positioning. Look for chart commentary and trader sentiment: is the asset trending bullish, bearish, or neutral? Cite the source.

3. SCAN NEWS FOR DRIVERS — Scan recent news for what is driving the move: macro factors (U.S. Fed, inflation, interest rate signals), crypto-specific or asset-specific news (ETFs, regulations, institutional buyers), and market psychology (fear/greed, trading volume, major selloffs). This explains WHY the asset is moving, not just what it is doing.

INPUT DATA REQUIREMENTS (power your card engine — all three must be satisfied for every finding you output):
1. TIMED TO THE PAST 5–7 DAYS ONLY. Exclude any development older than 7 days. When in doubt, omit. Cite the date of the event or report.${hasCrypto ? ' For crypto, prefer data up to the day or hour where available.' : ''}
2. FULLY CHECKED AGAINST MACRO SIGNALS. For every material finding (price move, earnings, flow), state whether macro (Fed, CPI, DXY, rates, risk-on/off) explains it, contradicts it, or is neutral. Run the macro pass and cross-check each finding against it.
3. CROSS-REFERENCED WITH LIQUIDATION, VOLUME, AND FLOW DATA. Where applicable: cite liquidation data (crypto, e.g. Coinglass), volume (trading volume, volume spikes), and flow data (ETF inflows/outflows, institutional flows). Do not report a price move without checking volume/liquidation/flow context.

STALE DATA — Do not use old prices or old articles. Only cite prices and facts from sources explicitly dated within the last 7 days of today (${dateStr}). If search returns an article or chart from 2023, 2024, or any date outside the last 7 days, ignore its price levels entirely. Sanity check: if a price looks wrong for "this week" (e.g. Bitcoin at $28k when it has been trading far above that recently), do not output it — it is stale. Prefer sources that show "as of [recent date]" or "this week"; when you mention a price, the source date must be within the past 7 days.

Today's date: ${dateStr}. Holdings: ${holdings.map((h) => `${h.symbol} (${h.name})`).join('; ')}.

RESEARCH FLOW — Run the query groups below IN ORDER. For each group, use web search (live search), then collect findings. STRICT: Only include developments from the past 5–7 days. Prefer the trusted sources above; for crypto, include Bloomberg, CoinDesk, FXStreet, CoinGecko, Investopedia, Economic Times so info is fresh.

QUERY SEQUENCE (search in this order):
`;
  for (const { holding, pass, queries } of grouped) {
    const passLabel = PASS_LABELS[pass];
    const label = holding ? `${holding.symbol} Pass ${pass}: ${passLabel}` : `Pass 3: ${passLabel} (shared)`;
    prompt += `\n--- ${label} ---\n`;
    for (const q of queries) {
      prompt += `• ${q}\n`;
    }
  }

  prompt += `

STRUCTURED REASONING — Triage each finding (required before output):
- VERIFY MARKET DATA: Did you check current price, weekly move (up/down), support/resistance, and analyst/trader positioning? State bullish/bearish/neutral where relevant.
- SCAN FOR DRIVERS: Does this finding explain WHY the asset moved (macro, ETFs, regulation, institutional, fear/greed, volume, selloffs)? Not just what — why.
- Was this just price noise or did sentiment flip?
- CHECK AGAINST MACRO: Does Fed/CPI/DXY/risk sentiment explain or contradict this move? State it in the bullet.
- CROSS-REFERENCE: For price moves, cite volume and/or liquidation (crypto) and/or flow data (ETF/institutional). Do not output a price move without this cross-reference.
- Are multiple assets reacting similarly (e.g. same macro reason)? If so, note it.
- Did it break a level that changes investor logic (e.g. support break)?

TAGGING — For each finding, assign ONE tag: ${TAGS}

OUTPUT STYLE (required): Plain, conversational English. Storyline and big picture. Mention prices only for context — do not get too technical.
- PLAIN, CONVERSATIONAL ENGLISH. Write like you're explaining to a friend: clear, natural, no jargon or corporate speak.
- STORYLINE, BIG PICTURE. Write each bullet as a short narrative: what happened and why it matters to a long-term investor. Lead with the story and the driver, not with numbers.
- PRICES FOR INFO ONLY. Include price or % only when it helps the story (e.g. "traded around $95k" or "down about 5% on the week"). Do not lead with price; do not pack in technical levels or multiple price points. One or two numbers per bullet is enough.
- NOT TOO TECHNICAL. Avoid analyst jargon, chart slang, or heavy technical detail (e.g. skip "support at 93.2k", "RSI divergence").

OUTPUT:
- One bullet per finding. Format: "- [storyline in plain conversational English; mention price only for context if needed]. Source, Date. Macro: [explains/contradicts/neutral]. [Tag: <tag>]"
- Example: "- Bitcoin slipped this week as risk-off sentiment and a stronger dollar weighed on crypto; liquidations picked up. Coinglass, Jan 28. Macro: risk-off, DXY up. [Tag: structural price move]"
- If no material change for a holding in a pass, output: "- No material change in the past 5–7 days for [ticker] in this pass. [Tag: no change]"
- List format only. No preamble or conclusion. Include ONLY past 5–7 days; every finding must satisfy the three input data requirements above.`;

  return prompt;
}

/**
 * Run OpenAI Responses API with web_search tool; return combined text and any citation URLs.
 */
export async function runOpenAIWebSearch(
  prompt: string,
  mode: NewsBriefMode
): Promise<{ text: string; urls: string[] }> {
  const apiKey = process.env.OPENAI_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_KEY or OPENAI_API_KEY is required for news brief.');
  }

  const config = MODE_CONFIG[mode];
  const clientOptions: { apiKey: string; timeout?: number } = { apiKey };
  if (config.timeout) clientOptions.timeout = config.timeout;
  const client = new OpenAI(clientOptions);

  const params: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: config.model,
    input: prompt,
    tools: [WEB_SEARCH_TOOL],
  };
  if (config.background) params.background = true;

  const response: OpenAI.Responses.Response = await client.responses.create(params);

  const text = extractOutputText(response);
  const urls = extractUrlsFromResponse(response);

  return { text, urls };
}

function extractOutputText(response: OpenAI.Responses.Response): string {
  if (typeof response.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  const output = response.output;
  if (!Array.isArray(output)) return '';

  const parts: string[] = [];
  for (const item of output) {
    const msg = item as { type?: string; content?: Array<{ type?: string; text?: string }> };
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
    const msg = item as { content?: Array<{ type?: string; url?: string; citation?: { url?: string } }> };
    if (!Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === 'output_text' && typeof block.url === 'string') urls.push(block.url);
      if (block.citation?.url) urls.push(block.citation.url);
    }
  }
  return [...new Set(urls)];
}

/**
 * Parse model output into a list of learning strings (one per bullet/line).
 */
export function parseLearningsFromText(text: string): string[] {
  const lines = text.split(/\n/).map((s) => s.trim()).filter(Boolean);
  const learnings: string[] = [];
  for (const line of lines) {
    // Strip leading "1.", "2.", "- ", "• ", "* "
    const cleaned = line
      .replace(/^\s*[\d]+[.)]\s*/, '')
      .replace(/^\s*[-•*]\s*/, '')
      .trim();
    if (cleaned.length > 0) {
      learnings.push(cleaned);
    }
  }
  return learnings;
}

export interface NewsBriefOpenAIOptions {
  holdings: HoldingEntry[];
  mode: NewsBriefMode;
  includeMacro: boolean;
  /** Optional: reference prices from Yahoo Finance; when set, prompt instructs model to use these and not contradict. */
  referencePrices?: Map<string, PriceData>;
}

/**
 * Run the full news brief: separately for each holding (Pass 1, Pass 2, Pass 3 per holding), then merge learnings and URLs.
 */
export async function newsBriefOpenAI({
  holdings,
  mode,
  includeMacro,
  referencePrices,
}: NewsBriefOpenAIOptions): Promise<{ learnings: string[]; urls: string[] }> {
  const passes: Array<1 | 2 | 3> = includeMacro ? [1, 2, 3] : [1, 2];
  const allLearnings: string[] = [];
  const allUrls: string[] = [];

  for (const holding of holdings) {
    for (const passNumber of passes) {
      const prompt = buildNewsBriefPromptForPass(
        [holding],
        includeMacro,
        passNumber,
        referencePrices
      );
      if (!prompt) continue;
      const { text, urls } = await runOpenAIWebSearch(prompt, mode);
      const learnings = parseLearningsFromText(text);
      allLearnings.push(...learnings);
      allUrls.push(...urls);
    }
  }

  return { learnings: allLearnings, urls: allUrls };
}
