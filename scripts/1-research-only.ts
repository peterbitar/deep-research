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
  console.log('🔬 Script 1: Research Only — fetch → research → save learnings to DB\n');

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
        console.warn(`   ⚠️  Unknown symbol "${sym}" (known: ${Object.keys(PREDEFINED_HOLDINGS).join(', ')})`);
      }
    }
    console.log(`📌 RESEARCH_SYMBOLS set: researching only ${holdings.map((h) => h.symbol).join(', ')}\n`);
  } else {
    // Fetch from holdings API
    const baseURL = getHoldingsBaseUrl();
    console.log(`📡 Holdings API: ${baseURL}\n`);

    // --- 1. Fetch users ---
    console.log('1️⃣  Fetching users...');
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
    console.log(`   ✅ ${users.length} user(s)\n`);

    // --- 2. Fetch holdings per user, deduplicate ---
    console.log('2️⃣  Fetching holdings per user...');
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
        console.log(`   📦 ${uid}: ${list.length} holdings`);
        allHoldings.push(...list);
      } catch (e) {
        console.warn(`   ⚠️  ${uid}: ${e instanceof Error ? e.message : String(e)}`);
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
    console.log(`   ⚠️  No holdings found - skipping holdings research\n`);
  } else {
    console.log(`   ✅ ${holdings.length} unique holdings\n`);
    console.log('3️⃣  Researching holdings...');
    
    // Parallelize holdings research with concurrency limit
    // Default: 8 for Firecrawl Standard (50 concurrent requests)
    // Each holding uses FIRECRAWL_CONCURRENCY (default 2) internally
    // So 8 holdings * 2 = 16 concurrent Firecrawl calls (well under 50 limit)
    const holdingsConcurrency = Number(process.env.HOLDINGS_CONCURRENCY) || 8;
    const holdingsLimit = pLimit(holdingsConcurrency);
    console.log(`   🔄 Researching ${holdings.length} holdings with concurrency ${holdingsConcurrency}...\n`);
    
    const researchPromises = holdings.map((h) =>
      holdingsLimit(async () => {
        const q = buildHoldingQuery(h);
        console.log(`   📊 ${h.symbol} (${h.type})...`);
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
          console.log(`      ✅ ${h.symbol}: ${learnings.length} learnings, ${visitedUrls.length} URLs`);
          return { symbol: h.symbol, learnings, visitedUrls, error: null };
        } catch (e) {
          console.error(`      ❌ ${h.symbol}:`, e instanceof Error ? e.message : String(e));
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
        console.error(`   ❌ Holding research failed:`, result.reason);
      }
    }

    // Save holdings learnings immediately (before macro scan)
    if (allLearnings.length > 0) {
      console.log('\n💾 Saving holdings learnings to database (before macro scan)...');
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
      console.log(`   ✅ Holdings learnings saved! Run ID: ${runId}`);
      console.log(`   - ${allLearnings.length} learnings, ${uniqueUrls.length} URLs\n`);
    }
  }

  // --- 4. Macro scan (always runs) ---
  console.log('4️⃣  Macro scan (Central Bank, Economic Data, Currency, Geopolitical)...');
  const macroLearnings: string[] = [];
  const macroUrls: string[] = [];
  try {
    const macro = await scanMacro(2, 1, undefined, undefined, runId);
    macroLearnings.push(...macro.learnings);
    macroUrls.push(...macro.visitedUrls);
    console.log(`   ✅ ${macro.learnings.length} learnings, ${macro.visitedUrls.length} URLs`);
    
    // Append macro learnings to existing ones
    allLearnings.push(...macroLearnings);
    allUrls.push(...macroUrls);
    
    // Save all learnings (holdings + macro) to DB
    console.log('\n💾 Saving all learnings to database...');
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
    console.log(`   ✅ All learnings saved!`);
  } catch (e) {
    console.error('   ❌ Macro scan failed:', e);
    if (allLearnings.length > 0) {
      console.log(`\n   ⚠️  Holdings learnings are still saved (Run ID: ${runId})`);
      console.log(`   You can proceed with "npm run generate-report ${runId}"\n`);
    } else {
      console.log(`\n   ❌ No learnings saved - research failed completely\n`);
    }
    process.exit(0); // Exit gracefully
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n   ⏱️  Research done in ${elapsed}s. Total: ${allLearnings.length} learnings, ${allUrls.length} URLs\n`);

  // Update status to completed
  await pool.query(
    `UPDATE research_runs SET status = 'completed' WHERE run_id = $1`,
    [runId]
  );

  console.log(`✅ All learnings saved! Run ID: ${runId}`);
  console.log(`   - ${allLearnings.length} total learnings (${holdings.length > 0 ? 'holdings + ' : ''}macro)`);
  console.log(`   - ${[...new Set(allUrls)].length} unique URLs`);
  console.log(`\n   Next step: Run "npm run generate-report ${runId}" to generate the report.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
