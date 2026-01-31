/**
 * Script 2: Generate Report from Saved Learnings
 * 
 * Loads learnings from DB and generates the report (Step 5).
 * Saves the initial report to DB (before rewriting).
 * 
 * Usage:
 *   npm run generate-report [runId]
 *   # or
 *   npx tsx --env-file=.env.local scripts/2-generate-report.ts [runId]
 * 
 * If runId is not provided, uses the latest research run.
 */

import { writeFinalReport } from '../src/deep-research';
import { getLearnings, saveReport } from '../src/db/reports';
import { pool } from '../src/db/client';

async function main() {
  const runId = process.argv[2];

  console.log('📝 Script 2: Generate Report from Saved Learnings\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Use Railway Postgres or similar.');
  }
  if (!pool) {
    throw new Error('Database pool not initialized. Check DATABASE_URL.');
  }

  // Get runId (use provided or latest)
  let targetRunId = runId;
  if (!targetRunId) {
    // Look for latest completed research run (research-only sets status to 'completed')
    const result = await pool.query(
      `SELECT run_id FROM research_runs WHERE status = 'completed' ORDER BY created_at DESC LIMIT 1`
    );
    if (result.rows.length === 0) {
      // Fallback: try 'researching' status in case research-only hasn't finished yet
      const fallbackResult = await pool.query(
        `SELECT run_id FROM research_runs WHERE status = 'researching' ORDER BY created_at DESC LIMIT 1`
      );
      if (fallbackResult.rows.length === 0) {
        throw new Error('No research run found. Run "npm run research-only" first.');
      }
      targetRunId = fallbackResult.rows[0].run_id;
    } else {
      targetRunId = result.rows[0].run_id;
    }
    console.log(`📊 Using latest research run: ${targetRunId}\n`);
  } else {
    console.log(`📊 Using run ID: ${targetRunId}\n`);
  }

  // Load learnings from DB
  console.log('1️⃣  Loading learnings from database...');
  const learningsData = await getLearnings(targetRunId);
  if (!learningsData) {
    throw new Error(`No learnings found for run ID: ${targetRunId}`);
  }

  const { learnings, urls } = learningsData;
  console.log(`   ✅ Loaded ${learnings.length} learnings, ${urls.length} URLs\n`);

  // Get holdings info from research run query
  const runResult = await pool.query(
    `SELECT query FROM research_runs WHERE run_id = $1`,
    [targetRunId]
  );
  const portfolioQuery = runResult.rows[0]?.query || 
    `Research the current week's developments for this portfolio.
This report combines individual holding-specific research and macro factors that impact the overall portfolio.
Focus on factual updates from the last 7 days that could impact portfolio performance.`;

  // Extract holdings from query - check for "HOLDINGS: SYMBOL1,SYMBOL2" format first
  let uniqueHoldings: string[] = [];
  
  const holdingsMatch = portfolioQuery.match(/HOLDINGS:\s*([A-Z0-9,]+)/i);
  if (holdingsMatch) {
    // Holdings are explicitly stored in query
    uniqueHoldings = holdingsMatch[1].split(',').map(s => s.toUpperCase().trim()).filter(s => s.length > 0);
    console.log(`   📊 Extracted ${uniqueHoldings.length} holdings from query: ${uniqueHoldings.join(', ')}\n`);
  } else {
    // Fallback: Try to extract from query patterns like "Research BB (Stock)"
    const holdingsFromQuery: string[] = [];
    const holdingPattern = /Research\s+([A-Z0-9]{1,5})\s*\(/gi;
    let match;
    while ((match = holdingPattern.exec(portfolioQuery)) !== null) {
      const symbol = match[1].toUpperCase().trim();
      if (symbol.length >= 2 && symbol.length <= 5) {
        holdingsFromQuery.push(symbol);
      }
    }
    
    // Also check for company names in query
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
    
    const upperQuery = portfolioQuery.toUpperCase();
    for (const [companyName, ticker] of Object.entries(companyNameMap)) {
      if (upperQuery.includes(companyName) && !holdingsFromQuery.includes(ticker)) {
        holdingsFromQuery.push(ticker);
      }
    }
    
    uniqueHoldings = [...new Set(holdingsFromQuery)].sort();
    if (uniqueHoldings.length > 0) {
      console.log(`   📊 Extracted ${uniqueHoldings.length} holdings from query patterns: ${uniqueHoldings.join(', ')}\n`);
    }
  }

  // Generate report (WITHOUT rewriting first)
  console.log('2️⃣  Generating report (this may take 1-3 minutes)...');
  const reportStartTime = Date.now();
  const { reportMarkdown, cardMetadata } = await writeFinalReport({
    prompt: portfolioQuery,
    learnings,
    visitedUrls: urls,
    skipRewrite: true, // Skip rewriting to save immediately
    holdings: uniqueHoldings.length > 0 ? uniqueHoldings : undefined,
  });

  const reportDuration = ((Date.now() - reportStartTime) / 1000).toFixed(1);
  console.log(`   ✅ Report generated in ${reportDuration}s\n`);

  // Save report to DB (with pipeline-tagged ticker/macro per card)
  console.log('3️⃣  Saving report to database...');
  const uniqueUrls = [...new Set(urls)];
  await saveReport({
    runId: targetRunId,
    query: portfolioQuery,
    depth: 1,
    breadth: 3,
    reportMarkdown,
    sources: uniqueUrls,
    cardMetadata,
  });

  console.log(`✅ Report saved! Run ID: ${targetRunId}`);
  console.log(`   Cards and sources are in DB.`);
  console.log(`\n   Next step: Run "npm run rewrite-report ${targetRunId}" to rewrite the report.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
