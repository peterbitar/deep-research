/**
 * Script 1: Research Only
 * 
 * Fetches holdings, runs research (holdings + macro), and saves learnings to DB.
 * This is Step 1-4 of the pipeline.
 * 
 * Usage:
 *   npm run research-only
 *   # or
 *   npx tsx --env-file=.env.local scripts/1-research-only.ts
 * 
 * Limit to specific symbols (no API fetch):
 *   RESEARCH_SYMBOLS=GOLD,SILVER,SPY,BTC npx tsx --env-file=.env.local scripts/1-research-only.ts
 */

import { deepResearch } from '../src/deep-research';
import { fetchUserHoldings } from '../src/fetch-holdings';
import { scanMacro } from '../src/macro-scan';
import { saveLearnings } from '../src/db/reports';
import { pool } from '../src/db/client';
import { logLine, logWarn, logError } from '../src/logger';
import pLimit from 'p-limit';

const DEFAULT_HOLDINGS_API =
  'https://wealthyrabbitios-production-03a4.up.railway.app';

/** Predefined holdings for RESEARCH_SYMBOLS (gold, silver, S&P 500, BTC) */
const PREDEFINED_HOLDINGS: Record<string, { symbol: string; type: string; name: string }> = {
  GOLD: { symbol: 'GOLD', type: 'Commodity', name: 'Gold' },
  GLD: { symbol: 'GLD', type: 'Commodity', name: 'Gold' },
  SILVER: { symbol: 'SILVER', type: 'Commodity', name: 'Silver' },
  SLV: { symbol: 'SLV', type: 'Commodity', name: 'Silver' },
  SPY: { symbol: 'SPY', type: 'Stock', name: 'S&P 500' },
  SPX: { symbol: 'SPX', type: 'Stock', name: 'S&P 500' },
  BTC: { symbol: 'BTC', type: 'Cryptocurrency', name: 'Bitcoin' },
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

function buildHoldingQuery(
  holding: { symbol: string; type: string; name: string }
): string {
  const type = holding.type || 'Unknown';
  const name = holding.name || holding.symbol;

  if (type === 'Stock') {
    return `Research ${holding.symbol} (${name}) developments in the last 7 days. Focus on: earnings releases, SEC filings (8-K, 10-Q, 10-K), regulatory actions, official announcements, partnerships, price movements (including crashes and all-time highs — when covering these, capture WHY, what happened before, and what next), analyst updates. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ, SEC filings).`;
  }
  if (type === 'Cryptocurrency') {
    return `Research ${holding.symbol} (${name}) developments in the last 7 days. Focus on: protocol upgrades, institutional adoption announcements, regulatory news, major hacks (confirmed), price movements (including crashes and all-time highs — when covering these, capture WHY, what happened before, and what next), exchange listings. Prioritize Tier 1 sources (Reuters, Bloomberg, official project announcements).`;
  }
  if (type === 'Commodity') {
    return `Research ${holding.symbol} (${name}) developments in the last 7 days. Focus on: price data (actual numbers), major price moves (crashes, spikes — when covering these, capture WHY, what happened before, and what next), supply/demand data (official sources like EIA, OPEC), producer decisions, inventory levels, geopolitical factors affecting supply. Prioritize Tier 1 sources (Reuters, Bloomberg, EIA, OPEC, government data).`;
  }
  if (type === 'Real Estate') {
    return `Research ${holding.symbol} (Real Estate Investment Trusts) developments in the last 7 days. Focus on: earnings releases, SEC filings, property acquisitions/dispositions, dividend announcements, interest rate impacts, sector trends. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ, SEC filings).`;
  }
  return `Research ${holding.symbol} (${name}) developments in the last 7 days. Focus on earnings, regulatory news, price movements, and official announcements. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ).`;
}

async function main() {
  console.log('🔬 Research — fetch → research → save\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Use Railway Postgres or similar.');
  }
  if (!pool) {
    throw new Error('Database pool not initialized. Check DATABASE_URL.');
  }

  const researchSymbolsEnv = process.env.RESEARCH_SYMBOLS?.trim();
  let holdings: Array<{ symbol: string; type: string; name: string }>;

  if (researchSymbolsEnv) {
    // Limit to predefined symbols (gold, silver, S&P 500, BTC) — no API fetch
    const symbols = researchSymbolsEnv.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    holdings = [];
    for (const sym of symbols) {
      const predefined = PREDEFINED_HOLDINGS[sym];
      if (predefined) {
        holdings.push(predefined);
      } else {
        logWarn(`Unknown symbol "${sym}"`);
      }
    }
    logLine(`Symbols: ${holdings.map((h) => h.symbol).join(', ')}`);
  } else {
    // Fetch from holdings API
    const baseURL = getHoldingsBaseUrl();

    // --- 1. Fetch users ---
    logLine('Fetching users...');
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
    logLine(`Users: ${users.length}`);

    // --- 2. Fetch holdings per user, deduplicate ---
    logLine('Fetching holdings...');
    const allHoldings: Array<{ symbol: string; type: string; name: string }> = [];
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
      } catch (e) {
        logWarn(`${uid}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    const seen = new Set<string>();
    holdings = allHoldings.filter((h) => {
      const s = h.symbol.toUpperCase().trim();
      if (seen.has(s)) return false;
      seen.add(s);
      return true;
    });
  }

  const breadthPerHolding = 3;
  const depthPerHolding = 1;
  const allLearnings: string[] = [];
  const allUrls: string[] = [];
  const start = Date.now();
  const runId = `research-${Date.now()}`;

  // --- 3. Research each holding (if any) ---
  if (holdings.length === 0) {
    logLine('No holdings — skipping research');
  } else {
    logLine(`Holdings: ${holdings.length} (${holdings.map(h => h.symbol).join(', ')})`);
    logLine('Researching...');

    const holdingsConcurrency = Number(process.env.HOLDINGS_CONCURRENCY) || 8;
    const holdingsLimit = pLimit(holdingsConcurrency);
    let doneCount = 0;

    const researchPromises = holdings.map((h) =>
      holdingsLimit(async () => {
        const q = buildHoldingQuery(h);
        try {
          const { learnings, visitedUrls } = await deepResearch({
            query: q,
            breadth: breadthPerHolding,
            depth: depthPerHolding,
            dataSaver: undefined,
            initialQuery: q,
            totalDepth: depthPerHolding,
            iteration: 1,
            researchLabel: h.symbol,
            dbRunId: runId,
          });
          doneCount++;
          logLine(`  [${doneCount}/${holdings.length}] ${h.symbol}: ${learnings.length} learnings`);
          return { symbol: h.symbol, learnings, visitedUrls, error: null };
        } catch (e) {
          doneCount++;
          logError(`${h.symbol}:`, e instanceof Error ? e.message : String(e));
          return { symbol: h.symbol, learnings: [], visitedUrls: [], error: e };
        }
      })
    );
    
    // Wait for all holdings research to complete
    const results = await Promise.allSettled(researchPromises);
    
    // Aggregate results
    for (const result of results) {
      if (result.status === 'fulfilled') {
        const { learnings, visitedUrls } = result.value;
        allLearnings.push(...learnings);
        allUrls.push(...visitedUrls);
      } else {
        logError('Holding failed:', result.reason);
      }
    }

    // Save holdings learnings immediately (before macro scan)
    if (allLearnings.length > 0) {
      logLine('Saving holdings learnings...');
      const holdingsSymbols = holdings.map(h => h.symbol.toUpperCase());
      await saveLearnings(runId, allLearnings, allUrls, holdingsSymbols);
      const uniqueUrls = [...new Set(allUrls)];
      for (let i = 0; i < uniqueUrls.length; i++) {
        await pool.query(
          `INSERT INTO report_sources (run_id, source_url, source_order)
           VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING`,
          [runId, uniqueUrls[i], i]
        );
      }
      logLine(`Holdings saved: ${allLearnings.length} learnings, ${uniqueUrls.length} URLs`);
    }
  }

  // --- 4. Macro scan (always runs) ---
  logLine('Macro scan...');
  const macroLearnings: string[] = [];
  const macroUrls: string[] = [];
  try {
    const macro = await scanMacro(2, 1, undefined, undefined, runId);
    macroLearnings.push(...macro.learnings);
    macroUrls.push(...macro.visitedUrls);
    logLine(`Macro: ${macro.learnings.length} learnings, ${macro.visitedUrls.length} URLs`);

    allLearnings.push(...macroLearnings);
    allUrls.push(...macroUrls);

    logLine('Saving all learnings...');
    const holdingsSymbols = holdings.length > 0 ? holdings.map(h => h.symbol.toUpperCase()) : undefined;
    await saveLearnings(runId, allLearnings, allUrls, holdingsSymbols);
    const allUniqueUrls = [...new Set(allUrls)];
    for (let i = 0; i < allUniqueUrls.length; i++) {
      await pool.query(
        `INSERT INTO report_sources (run_id, source_url, source_order)
         VALUES ($1, $2, $3)
         ON CONFLICT DO NOTHING`,
        [runId, allUniqueUrls[i], i]
      );
    }
    logLine('All learnings saved');
  } catch (e) {
    logError('Macro failed:', e);
    if (allLearnings.length > 0) {
      logLine(`Holdings saved (Run ${runId}) — run generate-report to continue`);
    } else {
      logError('No learnings saved');
    }
    process.exit(0); // Exit gracefully
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  const uniqueUrls = [...new Set(allUrls)].length;

  await pool.query(
    `UPDATE research_runs SET status = 'completed' WHERE run_id = $1`,
    [runId]
  );

  console.log(`\n✅ Research done — ${elapsed}s | ${allLearnings.length} learnings | ${uniqueUrls} URLs`);
  console.log(`Run ID: ${runId} → npm run generate-report ${runId}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
