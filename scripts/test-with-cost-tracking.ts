// Test script with time and cost tracking
// Tests the portfolio detection feature in deepResearch

// Load environment variables
import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { deepResearch, writeFinalReport } from '../src/deep-research';
import { PipelineDataSaver } from '../src/pipeline-data-saver';

// Simple cost estimation (rough estimates based on typical API pricing)
const COST_ESTIMATES = {
  // OpenAI o3-mini: ~$0.15 per 1M input tokens, ~$0.60 per 1M output tokens
  // DeepSeek R1: ~$0.14 per 1M input tokens, ~$0.28 per 1M output tokens
  // Using average: $0.15 per 1M input, $0.45 per 1M output
  llmInputPer1M: 0.15,
  llmOutputPer1M: 0.45,
  
  // Firecrawl: ~$0.10 per search, ~$0.05 per scrape
  firecrawlSearch: 0.10,
  firecrawlScrape: 0.05,
  
  // Rough token estimates
  avgTokensPerQuery: 200, // Input tokens for query generation
  avgTokensPerTriage: 500, // Input tokens for triage
  avgTokensPerFilter: 300, // Input tokens for filtering
  avgTokensPerLearning: 1000, // Input tokens for learning extraction
  avgTokensPerReport: 5000, // Input tokens for report generation
  avgOutputTokensPerLearning: 200, // Output tokens per learning
  avgOutputTokensPerReport: 3000, // Output tokens for report
};

function estimateCost(stats: {
  serpQueries: number;
  scrapes: number;
  learnings: number;
  llmCalls: number;
}): number {
  let cost = 0;
  
  // Firecrawl costs
  cost += stats.serpQueries * COST_ESTIMATES.firecrawlSearch;
  cost += stats.scrapes * COST_ESTIMATES.firecrawlScrape;
  
  // LLM costs (rough estimate)
  // Each LLM call uses roughly: query generation + triage + filter + learning extraction + report
  const avgInputTokensPerCall = 
    COST_ESTIMATES.avgTokensPerQuery +
    COST_ESTIMATES.avgTokensPerTriage +
    COST_ESTIMATES.avgTokensPerFilter +
    (COST_ESTIMATES.avgTokensPerLearning * stats.learnings) +
    COST_ESTIMATES.avgTokensPerReport;
  
  const avgOutputTokensPerCall = 
    (COST_ESTIMATES.avgOutputTokensPerLearning * stats.learnings) +
    COST_ESTIMATES.avgOutputTokensPerReport;
  
  const inputCost = (avgInputTokensPerCall * stats.llmCalls / 1_000_000) * COST_ESTIMATES.llmInputPer1M;
  const outputCost = (avgOutputTokensPerCall * stats.llmCalls / 1_000_000) * COST_ESTIMATES.llmOutputPer1M;
  
  cost += inputCost + outputCost;
  
  return cost;
}

async function testWithCostTracking() {
  console.log('🧪 Testing Deep Research with Cost & Time Tracking\n');
  console.log('=' .repeat(60));
  
  // Portfolio query that will trigger automatic portfolio detection
  const portfolioQuery = `Research portfolio: BTC (Cryptocurrency), XRP (Cryptocurrency), NVIDIA (Stock), AAPL (Stock), Gold (Commodity), Oil (Commodity). Consider macro factors like Fed policy and inflation.`;
  
  console.log('📊 Query:', portfolioQuery);
  console.log('');
  
  // Initialize data saver
  const dataSaver = new PipelineDataSaver();
  await dataSaver.initialize();
  console.log(`📁 Saving research data to: ${dataSaver.getRunDir()}\n`);
  
  const startTime = Date.now();
  
  // Track stats for cost estimation
  let totalSerpQueries = 0;
  let totalScrapes = 0;
  let totalLLMCalls = 0;
  
  try {
    console.log('🚀 Starting research...\n');
    
    // Run deep research (will automatically detect portfolio and research each holding)
    const { learnings, visitedUrls } = await deepResearch({
      query: portfolioQuery,
      breadth: 4, // Total breadth (will be distributed across holdings)
      depth: 1,   // Depth 1 for faster test
      dataSaver,
      initialQuery: portfolioQuery,
      totalDepth: 1,
    });
    
    console.log(`\n✅ Research complete!`);
    console.log(`  Total learnings: ${learnings.length}`);
    console.log(`  Total URLs: ${visitedUrls.length}\n`);
    
    // Estimate stats from data saver
    if (dataSaver.iterations) {
      for (const iter of dataSaver.iterations) {
        totalSerpQueries += iter.serpQueries?.length || 0;
        totalScrapes += iter.toScrape?.length || 0;
        // Rough estimate: 1 LLM call per query generation + 1 for triage + 1 for filter + 1 per learning + 1 for report
        totalLLMCalls += (iter.serpQueries?.length || 0) + 1 + 1 + (iter.learnings?.length || 0);
      }
    }
    
    // Generate final report
    console.log('📝 Generating final report...\n');
    const report = await writeFinalReport({
      prompt: portfolioQuery,
      learnings,
      visitedUrls,
    });
    
    // Add report generation LLM calls (3 calls: potential cards, self-feedback, final report)
    totalLLMCalls += 3;
    
    // Save report
    const reportPath = `${dataSaver.getRunDir()}/final-report.md`;
    await require('fs/promises').writeFile(reportPath, report, 'utf-8');
    console.log(`✅ Report saved to: ${reportPath}\n`);
    
    // Calculate time
    const totalTime = Date.now() - startTime;
    const minutes = Math.floor(totalTime / 60000);
    const seconds = ((totalTime % 60000) / 1000).toFixed(1);
    
    // Estimate cost
    const estimatedCost = estimateCost({
      serpQueries: totalSerpQueries,
      scrapes: totalScrapes,
      learnings: learnings.length,
      llmCalls: totalLLMCalls,
    });
    
    // Save summary
    await dataSaver.saveComprehensiveSummary(
      portfolioQuery,
      1, // totalDepth
      4, // totalBreadth (approximate)
      learnings,
      visitedUrls,
      {
        totalCost: estimatedCost,
        costByService: {
          'Firecrawl': (totalSerpQueries * COST_ESTIMATES.firecrawlSearch) + (totalScrapes * COST_ESTIMATES.firecrawlScrape),
          'LLM': estimatedCost - ((totalSerpQueries * COST_ESTIMATES.firecrawlSearch) + (totalScrapes * COST_ESTIMATES.firecrawlScrape)),
        },
        costByOperation: {
          'Search': totalSerpQueries * COST_ESTIMATES.firecrawlSearch,
          'Scrape': totalScrapes * COST_ESTIMATES.firecrawlScrape,
          'LLM Processing': estimatedCost - ((totalSerpQueries * COST_ESTIMATES.firecrawlSearch) + (totalScrapes * COST_ESTIMATES.firecrawlScrape)),
        },
      }
    );
    
    // Print final summary
    console.log('=' .repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('=' .repeat(60));
    console.log(`⏱️  Total Time: ${minutes}m ${seconds}s`);
    console.log(`💰 Estimated Cost: $${estimatedCost.toFixed(4)}`);
    console.log(`   - Firecrawl: $${((totalSerpQueries * COST_ESTIMATES.firecrawlSearch) + (totalScrapes * COST_ESTIMATES.firecrawlScrape)).toFixed(4)}`);
    console.log(`   - LLM: $${(estimatedCost - ((totalSerpQueries * COST_ESTIMATES.firecrawlSearch) + (totalScrapes * COST_ESTIMATES.firecrawlScrape))).toFixed(4)}`);
    console.log(`📈 Stats:`);
    console.log(`   - SERP Queries: ${totalSerpQueries}`);
    console.log(`   - Articles Scraped: ${totalScrapes}`);
    console.log(`   - Learnings Generated: ${learnings.length}`);
    console.log(`   - URLs Visited: ${visitedUrls.length}`);
    console.log(`   - Estimated LLM Calls: ${totalLLMCalls}`);
    console.log(`📁 Results saved to: ${dataSaver.getRunDir()}`);
    console.log('=' .repeat(60));
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const minutes = Math.floor(totalTime / 60000);
    const seconds = ((totalTime % 60000) / 1000).toFixed(1);
    
    console.error('\n❌ Error during research:', error);
    console.log(`\n⏱️  Time before error: ${minutes}m ${seconds}s`);
    throw error;
  }
}

// Run the test
testWithCostTracking().catch(console.error);
