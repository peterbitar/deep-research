/**
 * Test script that starts at step 5 (report generation) using existing scraped data.
 * 
 * This skips:
 * - Step 1: Fetch users
 * - Step 2: Fetch holdings
 * - Step 3: Research holdings
 * - Step 4: Macro scan
 * 
 * Starts directly at:
 * - Step 5: Generate report
 * - Step 6: Save to DB
 * - Step 7: Rewrite
 * 
 * Usage:
 *   npx tsx --env-file=.env.local scripts/test-report-generation.ts
 */

import { writeFinalReport } from '../src/deep-research';
import { saveReport } from '../src/db/reports';
import { pool } from '../src/db/client';

// Use the learnings from the latest successful research run
// Or provide your own test data
const TEST_LEARNINGS = [
  '[RECENT CHANGE] Netflix\'s Q4 2025 earnings report (as reported by WSJ on Jan 21, 2026) showed robust performance with revenue up 18% year over year and operating income increasing 30% YoY, helped by strong membership momentum (crossing the 325M paid membership milestone) and higher ad revenue (over $1.5B for the year). Despite these healthy fundamentals, shares declined in early trading—suggesting investor caution amid near‐term integration and regulatory uncertainty.',
  "[RECENT CHANGE] In its SEC Form 8-K dated Jan 19, 2026, Netflix amended its previously announced merger with Warner Bros. Discovery by switching to an all‐cash deal at $27.75 per WBD share. This restructuring (including accelerated shareholder vote set for April and increased bridge facility commitments now totalling approximately $42.2B) is designed to strengthen Netflix's negotiating position against competing bids and to mitigate risks from proxy challenges, even as regulatory scrutiny is expected to persist into next year.",
  '[RECENT CHANGE] On January 16, 2026, the Federal Reserve bolstered its communication strategy by issuing two high-level speeches—one by Vice Chair Jefferson addressing the economic outlook and monetary policy implementation and another by Vice Chair for Supervision Bowman focusing on supervisory insights—together with the announcement of the approval of Banco Inter, S.A.\'s application. Core policy fundamentals, such as the Fed funds target range of 3.50%–3.75%, PCE inflation at 2.8% (September 2025), and Q3 2025 GDP growth of +4.3%, remain unchanged, indicating a continuation of the existing policy stance rather than a turning point.',
];

const TEST_URLS = [
  'https://www.wsj.com/articles/netflix-earnings',
  'https://www.sec.gov/cgi-bin/viewer?action=view&cik=1065280&accession_number=0001193125-26-003019',
  'https://www.federalreserve.gov/newsevents/speech/jefferson20260116a.htm',
];

async function main() {
  console.log('🧪 Test: Report Generation (Step 5-7) using existing scraped data\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  if (!pool) {
    throw new Error('Database pool not initialized');
  }

  const portfolioQuery = `Research the current week's developments for this portfolio: NFLX (Stock).

This report combines:
1. Individual holding-specific research for NFLX
2. Macro factors that impact the overall portfolio

Focus on factual updates from the last 7 days that could impact portfolio performance.`;

  console.log('📊 Using test data:');
  console.log(`   - ${TEST_LEARNINGS.length} learnings`);
  console.log(`   - ${TEST_URLS.length} URLs\n`);

  // Step 5: Generate report
  console.log('5️⃣  Generating report...');
  const reportStartTime = Date.now();
  
  const reportMarkdown = await writeFinalReport({
    prompt: portfolioQuery,
    learnings: TEST_LEARNINGS,
    visitedUrls: TEST_URLS,
    skipRewrite: true, // Skip rewriting first to save immediately
  });

  const reportDuration = ((Date.now() - reportStartTime) / 1000).toFixed(1);
  console.log(`✅ Report generated in ${reportDuration}s\n`);

  const runId = `test-report-${Date.now()}`;

  // Step 6: Save to DB
  console.log('6️⃣  Saving to database (before rewriting)...');
  await saveReport({
    runId,
    query: 'Test: NFLX (holdings + macro)',
    depth: 1,
    breadth: 3,
    reportMarkdown,
    sources: TEST_URLS,
  });

  console.log(`✅ Report saved! Run ID: ${runId}`);
  console.log('   Cards and sources are in DB.\n');

  // Step 7: Rewrite
  console.log('7️⃣  Starting rewrite (this will update the report when complete)...\n');
  const rewriteStartTime = Date.now();

  try {
    console.log('   ⏳ Rewriting card content (this may take 1-3 minutes)...');
    const rewrittenReport = await writeFinalReport({
      prompt: portfolioQuery,
      learnings: TEST_LEARNINGS,
      visitedUrls: TEST_URLS,
      skipRewrite: false, // Do rewriting this time
    });

    const rewriteDuration = ((Date.now() - rewriteStartTime) / 1000).toFixed(1);
    console.log(`\n✍️  Rewrite completed in ${rewriteDuration}s, updating report in DB...`);

    await saveReport({
      runId, // Same run ID to update
      query: 'Test: NFLX (holdings + macro)',
      depth: 1,
      breadth: 3,
      reportMarkdown: rewrittenReport,
      sources: TEST_URLS,
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
    throw error;
  }

  console.log('✅ Test complete!');
  console.log(`   Use /api/report/cards?runId=${runId} to view the report.\n`);
}

main().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});
