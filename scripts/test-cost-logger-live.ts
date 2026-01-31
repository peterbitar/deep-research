/**
 * Minimal LIVE test: 1 real search, 1 real scrape, 1 real LLM call.
 * Uses the same integration as the pipeline (retryFirecrawlSearch, generateText).
 * Costs are logged to cost_logs table when DATABASE_URL is set.
 *
 * Usage: npx tsx --env-file=.env.local scripts/test-cost-logger-live.ts
 */

import FirecrawlApp from '@mendable/firecrawl-js';
import { retryFirecrawlSearch } from '../src/deep-research';
import { generateText } from '../src/ai/generate-with-cost-log';
import { getModel } from '../src/ai/providers';
import { pool, testConnection, initializeSchema } from '../src/db/client';
import { getCostSummary } from '../src/db/cost-logs';

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
});

async function main() {
  console.log('🧪 Cost Logger LIVE Test — 1 search, 1 scrape, 1 LLM call\n');

  if (!process.env.FIRECRAWL_KEY) {
    throw new Error('FIRECRAWL_KEY required for live test');
  }
  if (!process.env.OPENAI_KEY && !process.env.FIREWORKS_KEY) {
    throw new Error('OPENAI_KEY or FIREWORKS_KEY required for live test');
  }

  const connected = pool ? await testConnection() : false;
  if (connected) {
    await initializeSchema();
    console.log('✅ DB connected — costs will be logged\n');
  } else {
    console.log('⚠️  No DATABASE_URL — costs will not be persisted\n');
  }

  const beforeSummary = connected ? await getCostSummary() : null;

  // 1. One real Firecrawl search
  console.log('1️⃣  Firecrawl search...');
  const searchResult = await retryFirecrawlSearch(
    () => firecrawl.search('NVIDIA stock news this week', { limit: 3 }),
    'NVIDIA stock news this week',
    0,
    'search'
  );
  const firstUrl = searchResult.data?.[0]?.url;
  if (!firstUrl) {
    throw new Error('No search results');
  }
  console.log(`   ✅ Found ${searchResult.data.length} results, first: ${firstUrl.slice(0, 60)}...\n`);

  // 2. One real Firecrawl scrape
  console.log('2️⃣  Firecrawl scrape...');
  const scraped = await retryFirecrawlSearch(
    async () => {
      if (typeof (firecrawl as any).scrapeUrl === 'function') {
        return await (firecrawl as any).scrapeUrl(firstUrl, {
          formats: ['markdown'],
          onlyMainContent: true,
        });
      }
      if (typeof (firecrawl as any).scrape === 'function') {
        return await (firecrawl as any).scrape(firstUrl, {
          formats: ['markdown'],
          onlyMainContent: true,
        });
      }
      throw new Error('No scrape method available');
    },
    firstUrl,
    0,
    'scrape'
  );
  const md = scraped?.markdown || scraped?.data?.markdown || scraped?.content?.markdown || '';
  console.log(`   ✅ Scraped ${md.length} chars\n`);

  // 3. One real LLM call
  console.log('3️⃣  LLM call...');
  const { text } = await generateText({
    model: getModel(),
    prompt: `In one sentence, summarize this headline: "${searchResult.data[0]?.title || 'NVIDIA news'}."`,
  });
  console.log(`   ✅ Response: ${text.slice(0, 100)}...\n`);

  // Show cost delta
  if (connected) {
    const afterSummary = await getCostSummary();
    const delta =
      beforeSummary && afterSummary
        ? afterSummary.totalCost - beforeSummary.totalCost
        : afterSummary!.totalCost;

    console.log('📊 Cost summary (this run):');
    console.log(`   Total: $${delta.toFixed(4)}`);
    console.log(`   By service:`, afterSummary!.byService);
    console.log(`   By operation:`, afterSummary!.byOperation);
    console.log('\n✅ Live test done — costs logged to DB');
  } else {
    console.log('✅ Live test done (no DB to log costs)');
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('Test failed:', err);
  process.exit(1);
});
