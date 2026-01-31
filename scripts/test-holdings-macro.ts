// Test script for holdings and macro research
// Tests deep research with a portfolio of holdings and macro considerations
// Usage: tsx scripts/test-holdings-macro.ts [userId] [baseURL]
//   - userId: Optional user ID to fetch holdings from API (default: use hardcoded holdings)
//   - baseURL: Optional base URL for holdings API (default: http://localhost:3001)

import { deepResearch, writeFinalReport } from '../src/deep-research';
import { fetchUserHoldings } from '../src/fetch-holdings';
import { PipelineDataSaver } from '../src/pipeline-data-saver';
import { scanMacro } from '../src/macro-scan';

async function testHoldingsMacro() {
  console.log('🧪 Testing Holdings & Macro Research\n');

  // Get userId from command line args or environment variable (if empty, fetch from all users)
  const userId = process.argv[2] || process.env.USER_ID;
  const baseURL = process.argv[3] || process.env.HOLDINGS_API_BASE_URL || 'http://localhost:3001';

  // Portfolio holdings - fetch from API
  let holdings: Array<{ symbol: string; type: string; name: string }>;
  
  try {
    if (userId) {
      // Fetch holdings for specific user
      console.log(`📡 Fetching holdings from API for user: ${userId}...\n`);
      const fetchedHoldings = await fetchUserHoldings({ userId, baseURL });
      console.log(`✅ Fetched ${fetchedHoldings.length} holdings from API`);
      holdings = fetchedHoldings;
    } else {
      // Fetch holdings from ALL users
      console.log(`📡 Fetching all users from API...\n`);
      const usersResponse = await fetch(`${baseURL}/api/users`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      
      if (!usersResponse.ok) {
        throw new Error(`Failed to fetch users: ${usersResponse.status} ${usersResponse.statusText}`);
      }
      
      const users = await usersResponse.json();
      console.log(`✅ Found ${users.length} user(s)\n`);
      
      // Fetch holdings for each user and combine
      const allFetchedHoldings: Array<{ symbol: string; type: string; name: string }> = [];
      
      for (const user of users) {
        const user_id = user.user_id || user.userId;
        if (!user_id) continue;
        
        try {
          console.log(`  📡 Fetching holdings for user: ${user_id}...`);
          const userHoldings = await fetchUserHoldings({ userId: user_id, baseURL, healthCheck: false });
          console.log(`  ✅ Fetched ${userHoldings.length} holdings`);
          allFetchedHoldings.push(...userHoldings);
        } catch (error) {
          console.log(`  ⚠️  Error fetching holdings for ${user_id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      console.log(`\n✅ Total fetched: ${allFetchedHoldings.length} holdings from all users`);
      holdings = allFetchedHoldings;
    }
    
    // Remove duplicates based on symbol (case-insensitive) across all users
    const seenSymbols = new Set<string>();
    holdings = holdings.filter(holding => {
      const symbolUpper = holding.symbol.toUpperCase();
      if (seenSymbols.has(symbolUpper)) {
        return false; // Duplicate, skip it
      }
      seenSymbols.add(symbolUpper);
      return true; // First occurrence, keep it
    });
    
    const duplicatesRemoved = (userId ? (await fetchUserHoldings({ userId, baseURL })).length : holdings.length) - holdings.length;
    if (duplicatesRemoved > 0) {
      console.log(`🔍 Removed ${duplicatesRemoved} duplicate holding(s) across all users\n`);
    } else {
      console.log('\n');
    }
  } catch (error) {
    console.error(`⚠️  Failed to fetch holdings from API: ${error instanceof Error ? error.message : String(error)}`);
    console.log('📋 Falling back to hardcoded holdings...\n');
    holdings = [
      { symbol: 'XRP', type: 'Cryptocurrency', name: 'Ripple' },
      { symbol: 'NVIDIA', type: 'Stock', name: 'NVIDIA Corporation' },
    ];
  }

  console.log(`📊 Portfolio Holdings (${holdings.length} unique):`);
  holdings.forEach(h => console.log(`  - ${h.symbol} (${h.type}): ${h.name}`));
  console.log('');

  // Initialize data saver
  const dataSaver = new PipelineDataSaver();
  await dataSaver.initialize();
  console.log(`📁 Saving research data to: ${dataSaver.getRunDir()}\n`);

  const startTime = Date.now();
  const allLearnings: string[] = [];
  const allUrls: string[] = [];

  // Step 1: Research each holding individually
  console.log('🔍 Step 1: Researching individual holdings...\n');
  const breadthPerHolding = 3; // 3 queries per holding
  const depthPerHolding = 1; // Depth 1 for individual holdings

  for (const holding of holdings) {
    console.log(`\n📊 Researching ${holding.symbol} (${holding.type})...`);
    
    // Create specific query for this holding
    let holdingQuery = '';
    if (holding.type === 'Stock') {
      holdingQuery = `Research ${holding.symbol} (${holding.name}) developments in the last 7 days. Focus on: earnings releases, SEC filings (8-K, 10-Q, 10-K), regulatory actions, official announcements, partnerships, price movements, analyst updates. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ, SEC filings).`;
    } else if (holding.type === 'Cryptocurrency') {
      holdingQuery = `Research ${holding.symbol} (${holding.name}) developments in the last 7 days. Focus on: protocol upgrades, institutional adoption announcements, regulatory news, major hacks (confirmed), price movements, exchange listings. Prioritize Tier 1 sources (Reuters, Bloomberg, official project announcements).`;
    } else if (holding.type === 'Commodity') {
      holdingQuery = `Research ${holding.symbol} (${holding.name}) developments in the last 7 days. Focus on: price data (actual numbers), supply/demand data (official sources like EIA, OPEC), producer decisions, inventory levels, geopolitical factors affecting supply. Prioritize Tier 1 sources (Reuters, Bloomberg, EIA, OPEC, government data).`;
    } else if (holding.type === 'Real Estate') {
      holdingQuery = `Research ${holding.symbol} (Real Estate Investment Trusts) developments in the last 7 days. Focus on: earnings releases, SEC filings, property acquisitions/dispositions, dividend announcements, interest rate impacts, sector trends. Prioritize Tier 1 sources (Reuters, Bloomberg, FT, WSJ, SEC filings).`;
    }

    try {
      const { learnings: holdingLearnings, visitedUrls: holdingUrls } = await deepResearch({
        query: holdingQuery,
        breadth: breadthPerHolding,
        depth: depthPerHolding,
        dataSaver,
        initialQuery: holdingQuery,
        totalDepth: depthPerHolding,
        iteration: 1, // Set to 1 to skip portfolio detection
        researchLabel: holding.symbol, // Label this research with the holding symbol
      });

      console.log(`  ✅ ${holding.symbol}: ${holdingLearnings.length} learnings, ${holdingUrls.length} URLs`);
      allLearnings.push(...holdingLearnings);
      allUrls.push(...holdingUrls);
    } catch (error) {
      console.error(`  ❌ Error researching ${holding.symbol}:`, error);
    }
  }

  console.log(`\n✅ Holdings research complete!`);
  console.log(`  Total holdings learnings: ${allLearnings.length}`);
  console.log(`  Total holdings URLs: ${allUrls.length}\n`);

  // Step 2: Run macro scan for additional context (Central Bank Policy only)
  console.log('🌍 Step 2: Running macro scan (Central Bank Policy only)...\n');
  try {
    const macroResult = await scanMacro(2, 1, dataSaver, 'Central Bank Policy');
    console.log(`  ✅ Macro learnings: ${macroResult.learnings.length}`);
    console.log(`  ✅ Macro URLs: ${macroResult.visitedUrls.length}`);
    
    // Combine macro learnings with holdings research
    allLearnings.push(...macroResult.learnings);
    allUrls.push(...macroResult.visitedUrls);
    
    const totalTime = Date.now() - startTime;
    console.log(`\n✅ All research complete!`);
    console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
    console.log(`  Total learnings: ${allLearnings.length}`);
    console.log(`  Total URLs: ${allUrls.length}\n`);

    // Step 3: Generate and save final report
    console.log('📝 Step 3: Generating final report...\n');
    const portfolioQuery = `Research the current week's developments for this portfolio: ${holdings.map(h => `${h.symbol} (${h.type})`).join(', ')}. 

This report combines:
1. Individual holding-specific research for each asset
2. Macro factors that impact the overall portfolio

Focus on factual updates from the last 7 days that could impact portfolio performance.`;

    const { reportMarkdown } = await writeFinalReport({
      prompt: portfolioQuery,
      learnings: allLearnings,
      visitedUrls: allUrls,
    });

    const reportPath = await dataSaver.saveFinalReport(reportMarkdown, allLearnings, allUrls);
    console.log(`✅ Report saved to: ${reportPath}\n`);

    // Save comprehensive summary
    const summaryPath = await dataSaver.saveComprehensiveSummary(
      portfolioQuery,
      depthPerHolding,
      breadthPerHolding,
      allLearnings,
      allUrls,
    );

    console.log('📈 Test Results:');
    console.log(`  Run ID: ${dataSaver.getRunId()}`);
    console.log(`  Run Directory: ${dataSaver.getRunDir()}`);
    console.log(`  Report: ${reportPath}`);
    console.log(`  Summary: ${summaryPath}\n`);

    // List files created
    const fs = await import('fs/promises');
    const path = await import('path');
    const runDir = dataSaver.getRunDir();
    
    try {
      const files = await fs.readdir(runDir, { withFileTypes: true });
      console.log('📂 Files Created:');
      for (const file of files) {
        if (file.isDirectory()) {
          console.log(`  📁 ${file.name}/`);
          const iterFiles = await fs.readdir(path.join(runDir, file.name));
          iterFiles.forEach(f => console.log(`     - ${f}`));
        } else {
          console.log(`  📄 ${file.name}`);
        }
      }
    } catch (error) {
      console.error('Error listing files:', error);
    }

    console.log('\n✅ Holdings & Macro research test complete!');
  } catch (error) {
    console.error('Error in macro scan, continuing with holdings research only:', error);
    
    // Still generate report with holdings research
    const portfolioQuery = `Research the current week's developments for this portfolio: ${holdings.map(h => `${h.symbol} (${h.type})`).join(', ')}.`;
    
    const { reportMarkdown } = await writeFinalReport({
      prompt: portfolioQuery,
      learnings: allLearnings,
      visitedUrls: allUrls,
    });

    const reportPath = await dataSaver.saveFinalReport(reportMarkdown, allLearnings, allUrls);
    console.log(`✅ Report saved to: ${reportPath}\n`);
  }
}

testHoldingsMacro().catch(console.error);
