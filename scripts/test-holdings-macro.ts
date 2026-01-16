// Test script for holdings and macro research
// Tests deep research with a portfolio of holdings and macro considerations

import { deepResearch, writeFinalReport } from '../src/deep-research';
import { PipelineDataSaver } from '../src/pipeline-data-saver';
import { scanMacro } from '../src/macro-scan';

async function testHoldingsMacro() {
  console.log('🧪 Testing Holdings & Macro Research\n');

  // Portfolio holdings
  const holdings = [
    { symbol: 'BTC', type: 'Cryptocurrency', name: 'Bitcoin' },
    { symbol: 'XRP', type: 'Cryptocurrency', name: 'Ripple' },
    { symbol: 'Silver', type: 'Commodity', name: 'Silver' },
    { symbol: 'Gold', type: 'Commodity', name: 'Gold' },
    { symbol: 'Oil', type: 'Commodity', name: 'Crude Oil' },
    { symbol: 'REIT', type: 'Real Estate', name: 'Real Estate Investment Trusts' },
    { symbol: 'NVIDIA', type: 'Stock', name: 'NVIDIA Corporation' },
    { symbol: 'AAPL', type: 'Stock', name: 'Apple Inc.' },
  ];

  console.log('📊 Portfolio Holdings:');
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

  // Step 2: Run macro scan for additional context
  console.log('🌍 Step 2: Running macro scan...\n');
  try {
    const macroResult = await scanMacro(2, 1);
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

    const report = await writeFinalReport({
      prompt: portfolioQuery,
      learnings: allLearnings,
      visitedUrls: allUrls,
    });

    const reportPath = await dataSaver.saveFinalReport(report, allLearnings, allUrls);
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
    
    const report = await writeFinalReport({
      prompt: portfolioQuery,
      learnings: allLearnings,
      visitedUrls: allUrls,
    });

    const reportPath = await dataSaver.saveFinalReport(report, allLearnings, allUrls);
    console.log(`✅ Report saved to: ${reportPath}\n`);
  }
}

testHoldingsMacro().catch(console.error);
