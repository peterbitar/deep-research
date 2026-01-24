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

  console.log('✍️  Script 3: Rewrite Report\n');

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
    console.log(`📊 Using latest report: ${targetRunId}\n`);
  } else {
    console.log(`📊 Using run ID: ${targetRunId}\n`);
  }

  // Load learnings from DB (needed for rewrite)
  console.log('1️⃣  Loading learnings from database...');
  const learningsData = await getLearnings(targetRunId);
  if (!learningsData) {
    throw new Error(`No learnings found for run ID: ${targetRunId}`);
  }

  const { learnings, urls } = learningsData;
  console.log(`   ✅ Loaded ${learnings.length} learnings, ${urls.length} URLs\n`);

  // Get portfolio query from research run
  const runResult = await pool.query(
    `SELECT query FROM research_runs WHERE run_id = $1`,
    [targetRunId]
  );
  const portfolioQuery = runResult.rows[0]?.query || 
    `Research the current week's developments for this portfolio.
This report combines individual holding-specific research and macro factors that impact the overall portfolio.
Focus on factual updates from the last 7 days that could impact portfolio performance.`;

  // Rewrite report (this will regenerate and rewrite)
  console.log('2️⃣  Rewriting report (this may take 2-5 minutes)...');
  const rewriteStartTime = Date.now();
  const rewrittenReport = await writeFinalReport({
    prompt: portfolioQuery,
    learnings,
    visitedUrls: urls,
    skipRewrite: false, // Do rewriting this time
  });

  const rewriteDuration = ((Date.now() - rewriteStartTime) / 1000).toFixed(1);
  console.log(`   ✅ Rewrite completed in ${rewriteDuration}s\n`);

  // Update report in DB
  console.log('3️⃣  Updating report in database...');
  const uniqueUrls = [...new Set(urls)];
  await saveReport({
    runId: targetRunId, // Same run ID to update
    query: portfolioQuery,
    depth: 1,
    breadth: 3,
    reportMarkdown: rewrittenReport,
    sources: uniqueUrls,
  });

  const totalDuration = ((Date.now() - rewriteStartTime) / 1000).toFixed(1);
  console.log(`✅ Rewritten report updated in DB (total time: ${totalDuration}s)`);
  console.log(`   Run ID: ${targetRunId} (updated with rewritten content)`);
  console.log(`\n   ✅ Complete! Use /api/report/cards to serve the app.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
