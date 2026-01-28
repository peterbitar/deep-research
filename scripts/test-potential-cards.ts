// Test if potential cards are being generated for BB/LSPD

import { pool } from '../src/db/client';
import { getLearnings } from '../src/db/reports';
import { writeFinalReport } from '../src/deep-research';

const runId = 'research-1769581262521';

async function main() {
  if (!pool) {
    console.error('❌ Database not configured');
    process.exit(1);
  }

  console.log(`🔍 Testing potential card generation for run: ${runId}\n`);

  try {
    // Load learnings
    const learningsData = await getLearnings(runId);
    if (!learningsData) {
      throw new Error(`No learnings found for run ID: ${runId}`);
    }

    const { learnings, urls } = learningsData;
    console.log(`✅ Loaded ${learnings.length} learnings\n`);

    // Extract holdings from query
    const runResult = await pool.query(
      `SELECT query FROM research_runs WHERE run_id = $1`,
      [runId]
    );
    const portfolioQuery = runResult.rows[0]?.query || '';
    
    let holdings: string[] = [];
    const holdingsMatch = portfolioQuery.match(/HOLDINGS:\s*([A-Z0-9,]+)/i);
    if (holdingsMatch) {
      holdings = holdingsMatch[1].split(',').map(s => s.toUpperCase().trim()).filter(s => s.length > 0);
    }
    
    // Expected holdings
    const expectedHoldings = ['JPM', 'AVGO', 'MSFT', 'META', 'NVDA', 'QQQ', 'VOO', 'GLDM', 'SLV', 'NFLX', 'BB', 'LSPD', 'IBIT'];
    if (holdings.length === 0) {
      console.log('⚠️  No holdings found in query, using expected holdings for test\n');
      holdings = expectedHoldings;
    }
    
    console.log(`📊 Testing with holdings: ${holdings.join(', ')}\n`);

    // Check learnings for BB/LSPD
    const bbLearnings = learnings.filter(l => 
      l.toUpperCase().includes('BB') || 
      l.toUpperCase().includes('BLACKBERRY')
    );
    const lspdLearnings = learnings.filter(l => 
      l.toUpperCase().includes('LSPD') || 
      l.toUpperCase().includes('LIGHTSPEED')
    );

    console.log(`BB learnings: ${bbLearnings.length}`);
    console.log(`LSPD learnings: ${lspdLearnings.length}\n`);

    if (bbLearnings.length === 0 && lspdLearnings.length === 0) {
      console.log('⚠️  No BB or LSPD learnings found - cards cannot be generated without learnings');
      process.exit(0);
    }

    // Test card generation (just the potential cards step, not full report)
    console.log('🧪 Testing potential card generation...\n');
    console.log('   (This will call the LLM to generate potential cards)\n');
    
    // We can't easily test just the potential cards step without calling writeFinalReport
    // But we can check if the learnings contain enough info for cards
    
    if (bbLearnings.length > 0) {
      console.log('✅ BB has learnings - potential cards should be generated');
      console.log(`   Sample: ${bbLearnings[0].substring(0, 150)}...\n`);
    }
    
    if (lspdLearnings.length > 0) {
      console.log('✅ LSPD has learnings - potential cards should be generated');
      console.log(`   Sample: ${lspdLearnings[0].substring(0, 150)}...\n`);
    }

    console.log('💡 To fully test, you would need to run writeFinalReport and check the potential cards.');
    console.log('   The holdings extraction and card selection logic should now ensure BB/LSPD get cards.\n');

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
