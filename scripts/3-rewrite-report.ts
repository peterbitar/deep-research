/**
 * Script 3: Rewrite Report
 * 
 * Loads an existing report from DB, rewrites it (Step 7), and updates the DB.
 * 
 * Usage:
 *   npm run rewrite-report [runId]
 *   # or
 *   npx tsx --env-file=.env.local scripts/3-rewrite-report.ts [runId]
 * 
 * If runId is not provided, uses the latest report.
 */

import { writeFinalReport } from '../src/deep-research';
import { getLearnings, saveReport } from '../src/db/reports';
import { pool } from '../src/db/client';

async function main() {
  const runId = process.argv[2];

  console.log('✍️  Rewrite Report\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Use Railway Postgres or similar.');
  }
  if (!pool) {
    throw new Error('Database pool not initialized. Check DATABASE_URL.');
  }

  // Get runId (use provided or latest)
  let targetRunId = runId;
  if (!targetRunId) {
    const result = await pool.query(
      `SELECT run_id FROM reports ORDER BY created_at DESC LIMIT 1`
    );
    if (result.rows.length === 0) {
      throw new Error('No report found. Run "npm run generate-report" first.');
    }
    targetRunId = result.rows[0].run_id;
    console.log(`Run: ${targetRunId}\n`);
  } else {
    console.log(`Run: ${targetRunId}\n`);
  }

  console.log('Loading learnings...');
  const learningsData = await getLearnings(targetRunId);
  if (!learningsData) {
    throw new Error(`No learnings found for run ID: ${targetRunId}`);
  }

  const { learnings, urls } = learningsData;
  console.log(`Loaded: ${learnings.length} learnings\n`);

  // Get portfolio query from research run
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
    console.log(`Holdings: ${uniqueHoldings.join(', ')}\n`);
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
      console.log(`Holdings: ${uniqueHoldings.join(', ')}\n`);
    }
  }

  console.log('Rewriting (2-5 min)...');
  const rewriteStartTime = Date.now();
  const { reportMarkdown: rewrittenReport, cardMetadata } = await writeFinalReport({
    prompt: portfolioQuery,
    learnings,
    visitedUrls: urls,
    skipRewrite: false, // Do rewriting this time
    holdings: uniqueHoldings.length > 0 ? uniqueHoldings : undefined,
  });

  const rewriteDuration = ((Date.now() - rewriteStartTime) / 1000).toFixed(1);
  console.log(`Rewrite: ${rewriteDuration}s\n`);

  console.log('Updating DB...');
  const uniqueUrls = [...new Set(urls)];
  await saveReport({
    runId: targetRunId, // Same run ID to update
    query: portfolioQuery,
    depth: 1,
    breadth: 3,
    reportMarkdown: rewrittenReport,
    sources: uniqueUrls,
    cardMetadata,
  });

  const totalDuration = ((Date.now() - rewriteStartTime) / 1000).toFixed(1);
  console.log(`\n✅ Done — ${totalDuration}s | Run ID: ${targetRunId}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
