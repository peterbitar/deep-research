/**
 * Quick test for cost logger - logs sample costs and fetches from DB
 */

import { logLLMCost, logFirecrawlCost } from '../src/cost-logger';
import { pool, testConnection, initializeSchema } from '../src/db/client';
import { getCostLogs, getCostSummary } from '../src/db/cost-logs';

async function main() {
  console.log('🧪 Cost Logger Test\n');

  if (!process.env.DATABASE_URL) {
    console.log('⚠️  DATABASE_URL not set. Run with DATABASE_URL to test DB persistence.');
    console.log('   Testing in-memory flow only...\n');
  }

  const connected = pool ? await testConnection() : false;
  if (connected) {
    await initializeSchema();
    console.log('✅ DB connected, schema initialized\n');
  }

  // Log sample costs
  console.log('Logging sample costs...');
  await logLLMCost({
    modelId: 'o3-mini',
    inputTokens: 1000,
    outputTokens: 200,
    operation: 'generateObject',
  });
  await logFirecrawlCost({ operation: 'search' });
  await logFirecrawlCost({ operation: 'search' });
  await logFirecrawlCost({ operation: 'scrape', creditsUsed: 1 });
  console.log('✅ Logged: 1 LLM call, 2 searches (0 credits each), 1 scrape (1 credit)\n');

  if (connected) {
    const summary = await getCostSummary();
    const logs = await getCostLogs({ limit: 5 });

    console.log('Summary:', JSON.stringify(summary, null, 2));
    console.log('\nRecent logs:', logs.length);
    logs.forEach((l, i) =>
      console.log(`  ${i + 1}. ${l.service} ${l.operation} $${l.total_cost}`)
    );
    console.log('\n✅ Cost logger test passed');
  } else {
    console.log('✅ Cost logger calls completed (no DB to verify)');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
