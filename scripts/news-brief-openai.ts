/**
 * News brief pipeline: holdings from users → OpenAI web search → cards.
 * Does not modify the existing pipeline. Run IDs: news-openai-{mode}-{timestamp}.
 *
 * Usage:
 *   npm run news-brief
 *   NEWS_BRIEF_MODE=agentic npm run news-brief
 *   RESEARCH_SYMBOLS=SPY,BTC npm run news-brief   (optional override for testing)
 *
 * Env: NEWS_BRIEF_MODE (non-reasoning | agentic | deep-research), NEWS_BRIEF_MACRO (1/true),
 *      MAIN_BACKEND_URL or HOLDINGS_API_BASE_URL, OPENAI_KEY or OPENAI_API_KEY, DATABASE_URL.
 */

import { fetchUserHoldings } from '../src/fetch-holdings';
import { saveLearnings, saveReport } from '../src/db/reports';
import { writeFinalReport } from '../src/deep-research';
import { pool } from '../src/db/client';
import {
  newsBriefOpenAI,
  type NewsBriefMode,
  type HoldingEntry,
} from '../src/news-brief-openai';

const DEFAULT_HOLDINGS_API =
  'https://wealthyrabbitios-production-03a4.up.railway.app';

/** Predefined holdings for RESEARCH_SYMBOLS (testing only); otherwise holdings from users. */
const PREDEFINED_HOLDINGS: Record<string, HoldingEntry> = {
  GOLD: { symbol: 'GOLD', type: 'Commodity', name: 'Gold' },
  GLD: { symbol: 'GLD', type: 'Commodity', name: 'Gold' },
  SILVER: { symbol: 'SILVER', type: 'Commodity', name: 'Silver' },
  SLV: { symbol: 'SLV', type: 'Commodity', name: 'Silver' },
  SPY: { symbol: 'SPY', type: 'Stock', name: 'S&P 500' },
  SPX: { symbol: 'SPX', type: 'Stock', name: 'S&P 500' },
  BTC: { symbol: 'BTC', type: 'Cryptocurrency', name: 'Bitcoin' },
  NVDA: { symbol: 'NVDA', type: 'Stock', name: 'NVIDIA' },
  VOO: { symbol: 'VOO', type: 'ETF', name: 'Vanguard S&P 500' },
};

function getHoldingsBaseUrl(): string {
  const url =
    process.env.MAIN_BACKEND_URL ||
    process.env.HOLDINGS_API_BASE_URL ||
    DEFAULT_HOLDINGS_API;
  if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
    throw new Error(
      'Holdings API must not be local. Set MAIN_BACKEND_URL or HOLDINGS_API_BASE_URL to your production API (e.g. Railway).'
    );
  }
  return url;
}

function parseMode(): NewsBriefMode {
  const m = (process.env.NEWS_BRIEF_MODE ?? 'non-reasoning').toLowerCase();
  if (m === 'agentic' || m === 'deep-research') return m;
  return 'non-reasoning';
}

function parseIncludeMacro(): boolean {
  const v = process.env.NEWS_BRIEF_MACRO;
  if (v === undefined || v === '') return true;
  return v === '1' || v.toLowerCase() === 'true';
}

async function getHoldings(): Promise<HoldingEntry[]> {
  const researchSymbolsEnv = process.env.RESEARCH_SYMBOLS?.trim();
  if (researchSymbolsEnv) {
    const symbols = researchSymbolsEnv
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    const holdings: HoldingEntry[] = [];
    for (const sym of symbols) {
      const predefined = PREDEFINED_HOLDINGS[sym];
      if (predefined) holdings.push(predefined);
    }
    return holdings;
  }

  const baseURL = getHoldingsBaseUrl();
  const usersRes = await fetch(`${baseURL}/api/users`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });
  if (!usersRes.ok) {
    throw new Error(`Holdings API users failed: ${usersRes.status} ${usersRes.statusText}`);
  }
  const users = (await usersRes.json()) as Array<{ user_id?: string; userId?: string }>;
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('No users returned from holdings API.');
  }

  const allHoldings: HoldingEntry[] = [];
  for (const u of users) {
    const uid = u.user_id ?? u.userId;
    if (!uid) continue;
    try {
      const list = await fetchUserHoldings({
        userId: uid,
        baseURL,
        healthCheck: false,
      });
      allHoldings.push(...list);
    } catch (_e) {
      // skip failed user
    }
  }

  const seen = new Set<string>();
  return allHoldings.filter((h) => {
    const s = h.symbol.toUpperCase().trim();
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });
}

async function main() {
  console.log('News brief (OpenAI web search) — holdings from users → cards\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Use Railway Postgres or similar.');
  }
  if (!pool) {
    throw new Error('Database pool not initialized. Check DATABASE_URL.');
  }

  const mode = parseMode();
  const includeMacro = parseIncludeMacro();
  console.log(`Mode: ${mode} | Macro: ${includeMacro}\n`);

  const holdings = await getHoldings();
  if (holdings.length === 0) {
    throw new Error('No holdings. Set RESEARCH_SYMBOLS for testing or ensure holdings API returns users with holdings.');
  }
  console.log(`Holdings: ${holdings.length} (${holdings.map((h) => h.symbol).join(', ')})\n`);

  console.log('Calling OpenAI web search...');
  const start = Date.now();
  const { learnings, urls } = await newsBriefOpenAI({
    holdings,
    mode,
    includeMacro,
  });
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`Learnings: ${learnings.length} | URLs: ${urls.length} | ${elapsed}s\n`);

  const runId = `news-openai-${mode}-${Date.now()}`;
  const holdingsSymbols = holdings.map((h) => h.symbol.toUpperCase());

  await saveLearnings(runId, learnings, urls, holdingsSymbols);

  const uniqueUrls = [...new Set(urls)];
  for (let i = 0; i < uniqueUrls.length; i++) {
    await pool.query(
      `INSERT INTO report_sources (run_id, source_url, source_order)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [runId, uniqueUrls[i], i]
    );
  }

  await pool.query(
    `UPDATE research_runs SET status = 'completed' WHERE run_id = $1`,
    [runId]
  );

  const portfolioQuery = `Research in progress | HOLDINGS: ${holdingsSymbols.join(',')}`;
  console.log('Generating report (cards)...');
  const reportStart = Date.now();
  const { reportMarkdown, cardMetadata } = await writeFinalReport({
    prompt: portfolioQuery,
    learnings,
    visitedUrls: urls,
    skipRewrite: true,
    holdings: holdingsSymbols,
  });
  const reportElapsed = ((Date.now() - reportStart) / 1000).toFixed(1);
  const cardCount = cardMetadata?.length ?? 0;
  console.log(`Report: ${reportElapsed}s | Cards: ${cardCount}\n`);

  await saveReport({
    runId,
    query: portfolioQuery,
    depth: 0,
    breadth: 0,
    reportMarkdown,
    sources: uniqueUrls,
    cardMetadata,
  });

  console.log(`Run ID: ${runId}`);
  console.log(`View cards in app or: npm run rewrite-report ${runId}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
