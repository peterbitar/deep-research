// Wealthy Rabbit - Holdings-based daily intelligence

import * as fs from 'fs/promises';
import * as readline from 'readline';

import { getModel } from './ai/providers';
import { parseHoldings, getAssetName } from './holdings';
import { researchHoldings } from './research-holdings';
import { researchHoldingsWithPipeline } from './research-holdings-pipeline';
import { scanMacro } from './macro-scan';
import { writeWealthyRabbitReport } from './wealthy-rabbit-report';

// Helper function for consistent logging
function log(...args: any[]) {
  console.log(...args);
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

// Helper function to get user input
function askQuestion(query: string): Promise<string> {
  return new Promise(resolve => {
    rl.question(query, answer => {
      resolve(answer);
    });
  });
}

// Run Wealthy Rabbit
async function run() {
  console.log('🐰 Wealthy Rabbit - Daily Holdings Intelligence\n');
  console.log('Using model: ', getModel().modelId);
  console.log('');

  // Get holdings input
  const holdingsInput = await askQuestion(
    'Enter your holdings (comma-separated, e.g., AAPL, NVDA, BTC, XOM): '
  );
  
  if (!holdingsInput.trim()) {
    console.log('No holdings provided. Exiting.');
    rl.close();
    return;
  }

  // Parse holdings
  const holdings = parseHoldings(holdingsInput);
  console.log(`\n📊 Parsed ${holdings.length} holdings:`);
  holdings.forEach(h => {
    const name = getAssetName(h);
    console.log(`  - ${h.symbol} (${h.type})${name !== h.symbol ? ` - ${name}` : ''}`);
  });

  // Get research parameters
  const breadth =
    parseInt(
      await askQuestion(
        '\nEnter research breadth per holding (recommended 2-5, default 3): '
      ),
      10,
    ) || 3;
  const depth =
    parseInt(
      await askQuestion('Enter research depth (recommended 1-2, default 1): '),
      10,
    ) || 1;

  // Ask about macro scan
  const includeMacro =
    (await askQuestion('\nInclude macro & liquidity scan? (y/n, default y): '))
      .toLowerCase() !== 'n';

  // Ask about pipeline mode
  const usePipeline =
    (await askQuestion('\nUse pipeline mode (scoring + conditional deep research)? (y/n, default n): '))
      .toLowerCase() === 'y';

  console.log('\n🔍 Starting research...\n');

  // Research each holding (with or without pipeline)
  const holdingsResults = usePipeline
    ? await researchHoldingsWithPipeline(holdings, breadth, depth, true) // verbose = true
    : await researchHoldings(holdings, breadth, depth);

  // Scan macro conditions (optional, can run in parallel)
  let macroResult = null;
  if (includeMacro) {
    macroResult = await scanMacro(Math.min(breadth, 2), depth);
  }

  console.log('\n✅ Research complete!\n');
  console.log('Summary:');
  holdingsResults.forEach(result => {
    const status = result.hasFactualUpdates ? '✅ Changed' : '❌ Unchanged';
    console.log(`  - ${result.holding.symbol}: ${status} (${result.learnings.length} learnings)`);
  });
  if (macroResult) {
    console.log(`  - Macro: ${macroResult.learnings.length} learnings`);
  }

  console.log('\n📝 Generating Wealthy Rabbit report...\n');

  // Generate report
  const report = await writeWealthyRabbitReport({
    holdingsResults,
    macroLearnings: macroResult?.learnings,
    macroUrls: macroResult?.visitedUrls,
  });

  // Save report
  await fs.writeFile('report.md', report, 'utf-8');
  console.log('\n✅ Report saved to report.md');
  console.log('\n📄 Report Preview:\n');
  console.log(report.substring(0, 1500) + '...\n');

  rl.close();
}

run().catch(console.error);
