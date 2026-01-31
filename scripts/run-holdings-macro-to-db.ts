/**
 * Run holdings + macro research and persist report to DB only (no local output).
 *
 * Flow:
 * 1. Fetch all users from holdings API
 * 2. Fetch holdings per user, deduplicate by symbol
 * 3. Research each holding (deepResearch) + macro scan (Central Bank Policy)
 * 4. Generate final report and save to DB (research_runs, reports, report_cards, report_sources)
 *
 * Requires:
 * - DATABASE_URL (Railway Postgres or similar)
 * - MAIN_BACKEND_URL or HOLDINGS_API_BASE_URL (holdings API; defaults to production Railway)
 * - FIRECRAWL_KEY, OPENAI_KEY or FIREWORKS_KEY
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/run-holdings-macro-to-db.ts
 *   # or
 *   npm run tsx scripts/run-holdings-macro-to-db.ts
 */

import { deepResearch, writeFinalReport } from '../src/deep-research';
import { fetchUserHoldings } from '../src/fetch-holdings';
import { scanMacro } from '../src/macro-scan';
import { saveReport } from '../src/db/reports';
import { pool } from '../src/db/client';

const DEFAULT_HOLDINGS_API =
  'https://wealthyrabbitios-production-03a4.up.railway.app';

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
    return `Research ${holding.symbol} (${name}) developments in the last 7 days. Focus on: earnings releases, SEC filings (8-K, 10-Q, 10-K), regulatory actions, official announcements, partnerships, price movements, analyst updates. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ, SEC filings).`;
  }
  if (type === 'Cryptocurrency') {
    return `Research ${holding.symbol} (${name}) developments in the last 7 days. Focus on: protocol upgrades, institutional adoption announcements, regulatory news, major hacks (confirmed), price movements, exchange listings. Prioritize Tier 1 sources (Reuters, Bloomberg, official project announcements).`;
  }
  if (type === 'Commodity') {
    return `Research ${holding.symbol} (${name}) developments in the last 7 days. Focus on: price data (actual numbers), supply/demand data (official sources like EIA, OPEC), producer decisions, inventory levels, geopolitical factors affecting supply. Prioritize Tier 1 sources (Reuters, Bloomberg, EIA, OPEC, government data).`;
  }
  if (type === 'Real Estate') {
    return `Research ${holding.symbol} (Real Estate Investment Trusts) developments in the last 7 days. Focus on: earnings releases, SEC filings, property acquisitions/dispositions, dividend announcements, interest rate impacts, sector trends. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ, SEC filings).`;
  }
  return `Research ${holding.symbol} (${name}) developments in the last 7 days. Focus on earnings, regulatory news, price movements, and official announcements. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ).`;
}

async function main() {
  console.log('🏃 run-holdings-macro-to-db — fetch → research → DB only\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Use Railway Postgres or similar.');
  }
  if (!pool) {
    throw new Error('Database pool not initialized. Check DATABASE_URL.');
  }

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
  const holdings = allHoldings.filter((h) => {
    const s = h.symbol.toUpperCase().trim();
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });

  if (holdings.length === 0) {
    throw new Error('No holdings after deduplication. Cannot run research.');
  }
  console.log(`   ✅ ${holdings.length} unique holdings\n`);

  // --- 3. Research each holding + macro ---
  const breadthPerHolding = 3;
  const depthPerHolding = 1;
  const allLearnings: string[] = [];
  const allUrls: string[] = [];
  const start = Date.now();

  console.log('3️⃣  Researching holdings...');
  for (const h of holdings) {
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
      });
      allLearnings.push(...learnings);
      allUrls.push(...visitedUrls);
      console.log(`      ✅ ${learnings.length} learnings, ${visitedUrls.length} URLs`);
    } catch (e) {
      console.error(`      ❌ ${h.symbol}:`, e);
    }
  }

  console.log('\n4️⃣  Macro scan (Central Bank Policy)...');
  try {
    const macro = await scanMacro(2, 1, undefined, 'Central Bank Policy');
    allLearnings.push(...macro.learnings);
    allUrls.push(...macro.visitedUrls);
    console.log(`   ✅ ${macro.learnings.length} learnings, ${macro.visitedUrls.length} URLs`);
  } catch (e) {
    console.error('   ❌ Macro scan failed:', e);
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n   ⏱️  Research done in ${elapsed}s. Learnings: ${allLearnings.length}, URLs: ${allUrls.length}\n`);

  // --- 4. Generate report and save to DB ---
  console.log('5️⃣  Generating report...');
  const portfolioQuery = `Research the current week's developments for this portfolio: ${holdings.map((h) => `${h.symbol} (${h.type})`).join(', ')}.

This report combines:
1. Individual holding-specific research for each asset
2. Macro factors that impact the overall portfolio

Focus on factual updates from the last 7 days that could impact portfolio performance.`;

  // Generate report WITHOUT rewriting first (save immediately)
  const { reportMarkdown, cardMetadata } = await writeFinalReport({
    prompt: portfolioQuery,
    learnings: allLearnings,
    visitedUrls: allUrls,
    skipRewrite: true, // Skip rewriting to save immediately
  });

  const runId = `research-${Date.now()}`;
  const uniqueUrls = [...new Set(allUrls)];

  console.log('6️⃣  Saving to database (before rewriting)...');
  await saveReport({
    runId,
    query: `Portfolio: ${holdings.map((h) => h.symbol).join(', ')} (holdings + macro)`,
    depth: depthPerHolding,
    breadth: breadthPerHolding,
    reportMarkdown,
    sources: uniqueUrls,
    cardMetadata,
  });

  console.log(`✅ Report saved! Run ID: ${runId}`);
  console.log('   Cards and sources are in DB.\n');
  console.log('🔄 Starting rewrite (this will update the report when complete)...\n');

  // Track rewrite progress
  const rewriteStartTime = Date.now();

  try {
    // Rewrite synchronously (blocking) to ensure it completes
    console.log('   ⏳ Rewriting card content (this may take 1-3 minutes)...');
    const { reportMarkdown: rewrittenReport, cardMetadata: rewriteCardMetadata } = await writeFinalReport({
      prompt: portfolioQuery,
      learnings: allLearnings,
      visitedUrls: allUrls,
      skipRewrite: false, // Do rewriting this time
    });

    const rewriteDuration = ((Date.now() - rewriteStartTime) / 1000).toFixed(1);
    console.log(`\n✍️  Rewrite completed in ${rewriteDuration}s, updating report in DB...`);
    
    await saveReport({
      runId, // Same run ID to update
      query: `Portfolio: ${holdings.map((h) => h.symbol).join(', ')} (holdings + macro)`,
      depth: depthPerHolding,
      breadth: breadthPerHolding,
      reportMarkdown: rewrittenReport,
      sources: uniqueUrls,
      cardMetadata: rewriteCardMetadata,
    });

    const totalDuration = ((Date.now() - rewriteStartTime) / 1000).toFixed(1);
    console.log(`✅ Rewritten report updated in DB (total rewrite time: ${totalDuration}s)`);
    console.log(`   Run ID: ${runId} (updated with rewritten content)\n`);
  } catch (error) {
    const rewriteDuration = ((Date.now() - rewriteStartTime) / 1000).toFixed(1);
    console.error(`\n⚠️  Rewrite failed after ${rewriteDuration}s (original report is still saved)`);
    console.error(`   Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`   Stack: ${error.stack.split('\n').slice(0, 5).join('\n')}`);
    }
    throw error; // Re-throw to fail the script since rewrite is important
  }

  console.log('   Use /api/report/cards to serve the app.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
