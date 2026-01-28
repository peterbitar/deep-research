// Test holdings extraction with actual learnings from run research-1769581262521

import { pool } from '../src/db/client';
import { getLearnings } from '../src/db/reports';

const runId = 'research-1769581262521';

// Simulate the holdings extraction logic from writeFinalReport
function extractHoldingsFromLearnings(learnings: string[]): string[] {
  const holdingsSet = new Set<string>();
  const tickerPattern = /(?:^|[\s$\(,])([A-Z0-9]{1,5})(?=[\s\)\.,;:]|$)/g;
  const commonWords = new Set([
    'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 
    'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO',
    'BOY', 'DID', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'HAD', 'WITH', 'THIS', 'WEEK', 'THAT', 'FROM',
    'INTO', 'ONLY', 'OVER', 'UNDER', 'AFTER', 'BEFORE', 'ABOUT', 'ABOVE', 'BELOW', 'BETWEEN', 'AMONG',
    'STOCK', 'PRICE', 'SHARES', 'MARKET', 'TRADING', 'EARNINGS', 'REVENUE', 'GROWTH', 'SALES', 'PROFIT',
    'RECENT', 'CHANGE', 'CONTEXT', 'TREND', 'LONG', 'TERM', 'SHORT', 'TERM', 'METADATA'
  ]);
  
  for (const learning of learnings) {
    const upperLearning = learning.toUpperCase();
    let match;
    while ((match = tickerPattern.exec(upperLearning)) !== null) {
      const symbol = match[1];
      if (symbol.length >= 2 && 
          symbol.length <= 5 && 
          /[A-Z]/.test(symbol) && 
          !commonWords.has(symbol)) {
        holdingsSet.add(symbol);
      }
    }
  }
  return Array.from(holdingsSet).sort();
}

async function main() {
  if (!pool) {
    console.error('❌ Database not configured');
    process.exit(1);
  }

  console.log(`🔍 Testing holdings extraction for run: ${runId}\n`);

  try {
    // Load learnings
    const learningsData = await getLearnings(runId);
    if (!learningsData) {
      throw new Error(`No learnings found for run ID: ${runId}`);
    }

    const { learnings } = learningsData;
    console.log(`✅ Loaded ${learnings.length} learnings\n`);

    // Extract holdings
    const extractedHoldings = extractHoldingsFromLearnings(learnings);
    console.log(`📊 Extracted holdings: ${extractedHoldings.join(', ')}`);
    console.log(`   Total: ${extractedHoldings.length} holdings\n`);

    // Check for BB and LSPD specifically
    const hasBB = extractedHoldings.includes('BB');
    const hasLSPD = extractedHoldings.includes('LSPD');
    
    console.log(`BB detected: ${hasBB ? '✅' : '❌'}`);
    console.log(`LSPD detected: ${hasLSPD ? '✅' : '❌'}\n`);

    // Find learnings that mention BB or LSPD
    console.log('🔍 Searching for BB/LSPD in learnings...\n');
    
    const bbLearnings = learnings.filter(l => 
      l.toUpperCase().includes('BB') || 
      l.toUpperCase().includes('BLACKBERRY')
    );
    const lspdLearnings = learnings.filter(l => 
      l.toUpperCase().includes('LSPD') || 
      l.toUpperCase().includes('LIGHTSPEED')
    );

    console.log(`BB mentions: ${bbLearnings.length} learnings`);
    if (bbLearnings.length > 0) {
      console.log('\n   Sample BB learning:');
      const sample = bbLearnings[0].substring(0, 200) + (bbLearnings[0].length > 200 ? '...' : '');
      console.log(`   ${sample}\n`);
    }

    console.log(`LSPD mentions: ${lspdLearnings.length} learnings`);
    if (lspdLearnings.length > 0) {
      console.log('\n   Sample LSPD learning:');
      const sample = lspdLearnings[0].substring(0, 200) + (lspdLearnings[0].length > 200 ? '...' : '');
      console.log(`   ${sample}\n`);
    }

    // Test regex on sample learnings
    if (bbLearnings.length > 0) {
      console.log('🧪 Testing regex on BB learning...');
      const testLearning = bbLearnings[0].toUpperCase();
      const matches: string[] = [];
      const regex = /(?:^|[\s$\(,])([A-Z0-9]{1,5})(?=[\s\)\.,;:]|$)/g;
      let match;
      while ((match = regex.exec(testLearning)) !== null) {
        matches.push(match[1]);
      }
      console.log(`   Matches found: ${matches.join(', ')}`);
      console.log(`   Contains 'BB': ${matches.includes('BB') ? '✅' : '❌'}\n`);
    }

    // Expected holdings from the log
    const expectedHoldings = ['JPM', 'AVGO', 'MSFT', 'META', 'NVDA', 'QQQ', 'VOO', 'GLDM', 'SLV', 'NFLX', 'BB', 'LSPD', 'IBIT'];
    console.log('📋 Expected holdings (from log):', expectedHoldings.join(', '));
    console.log(`   Total expected: ${expectedHoldings.length}\n`);

    const missing = expectedHoldings.filter(h => !extractedHoldings.includes(h));
    const extra = extractedHoldings.filter(h => !expectedHoldings.includes(h));

    if (missing.length > 0) {
      console.log(`⚠️  Missing from extraction: ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      console.log(`ℹ️  Extra in extraction: ${extra.join(', ')}`);
    }
    if (missing.length === 0 && extra.length === 0) {
      console.log('✅ All expected holdings detected!');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
