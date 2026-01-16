// Quick test for BTC research to diagnose why holdings return 0 results

import * as dotenv from 'dotenv';
import * as path from 'path';
dotenv.config({ path: path.join(__dirname, '../.env.local') });

import { deepResearch } from '../src/deep-research';
import { PipelineDataSaver } from '../src/pipeline-data-saver';

async function testBTCOnly() {
  console.log('🧪 Testing BTC Research Only\n');
  console.log('='.repeat(60));
  
  // Test BTC research directly
  const btcQuery = `Research BTC (Bitcoin) cryptocurrency news and developments from the last 7 days. 

IMPORTANT: Generate queries that include:
1. At least one broad, simple query for general recent news (e.g., "Bitcoin news January 2026" or "BTC cryptocurrency news last week")
2. Search for both "BTC" and "Bitcoin" terms in all queries
3. Include queries about: protocol upgrades, institutional adoption, regulatory news, major hacks (confirmed), price movements, exchange listings, crypto market trends
4. Use date ranges like "January 2026" or "last week" - avoid restrictive "last 7 days" quotes
5. Start with broad news queries, then add specific technical queries

Focus on: protocol upgrades, institutional adoption announcements, regulatory news, major hacks (confirmed), price movements, exchange listings, crypto market trends. Prioritize Tier 1 sources (Reuters, Bloomberg, official project announcements).`;
  
  console.log('📊 Query:', btcQuery.substring(0, 200) + '...\n');
  
  // Initialize data saver
  const dataSaver = new PipelineDataSaver();
  await dataSaver.initialize();
  console.log(`📁 Saving research data to: ${dataSaver.getRunDir()}\n`);
  
  const startTime = Date.now();
  
  try {
    console.log('🚀 Starting BTC research...\n');
    
    console.log('Calling deepResearch with:', {
      query: btcQuery.substring(0, 100),
      breadth: 3,
      depth: 1,
      iteration: 1,
      researchLabel: 'BTC'
    });
    
    let result;
    try {
      result = await deepResearch({
        query: btcQuery,
        breadth: 3, // Use 3 queries for BTC
        depth: 1,
        dataSaver,
        iteration: 1, // Set to 1 to skip portfolio detection
        initialQuery: btcQuery,
        totalDepth: 1,
        researchLabel: 'BTC',
      });
    } catch (error) {
      console.error('❌ Error in deepResearch:', error);
      throw error;
    }
    
    console.log('Result:', result);
    console.log('Result type:', typeof result);
    
    if (!result) {
      console.error('❌ deepResearch returned undefined!');
      return;
    }
    
    const { learnings, visitedUrls } = result;
    
    const totalTime = Date.now() - startTime;
    const seconds = (totalTime / 1000).toFixed(1);
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 BTC RESEARCH RESULTS');
    console.log('='.repeat(60));
    console.log(`⏱️  Total Time: ${seconds}s`);
    console.log(`📈 Stats:`);
    console.log(`   - Learnings Generated: ${learnings.length}`);
    console.log(`   - URLs Visited: ${visitedUrls.length}`);
    
    if (learnings.length > 0) {
      console.log(`\n✅ Learnings:`);
      learnings.forEach((l, i) => {
        console.log(`   ${i + 1}. ${l.substring(0, 150)}...`);
      });
    } else {
      console.log(`\n⚠️  WARNING: No learnings found!`);
    }
    
    if (visitedUrls.length > 0) {
      console.log(`\n🔗 URLs:`);
      visitedUrls.slice(0, 5).forEach((url, i) => {
        console.log(`   ${i + 1}. ${url}`);
      });
      if (visitedUrls.length > 5) {
        console.log(`   ... and ${visitedUrls.length - 5} more`);
      }
    } else {
      console.log(`\n⚠️  WARNING: No URLs visited!`);
    }
    
    console.log(`\n📁 Results saved to: ${dataSaver.getRunDir()}`);
    console.log('='.repeat(60));
    
  } catch (error) {
    const totalTime = Date.now() - startTime;
    const seconds = (totalTime / 1000).toFixed(1);
    
    console.error('\n❌ Error during BTC research:', error);
    console.log(`\n⏱️  Time before error: ${seconds}s`);
    throw error;
  }
}

// Run the test
testBTCOnly().catch(console.error);
