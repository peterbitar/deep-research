// Test holdings extraction from research query

import { pool } from '../src/db/client';

const runId = 'research-1769581262521';

async function main() {
  if (!pool) {
    console.error('❌ Database not configured');
    process.exit(1);
  }

  try {
    const result = await pool.query(
      `SELECT query FROM research_runs WHERE run_id = $1`,
      [runId]
    );
    
    if (result.rows.length === 0) {
      console.error('❌ No research run found');
      process.exit(1);
    }

    const query = result.rows[0].query;
    console.log('📋 Research Query:');
    console.log(query.substring(0, 500) + (query.length > 500 ? '...' : ''));
    console.log(`\n   Total length: ${query.length} characters\n`);

    // Test extraction
    const holdingsFromQuery: string[] = [];
    const holdingPattern = /Research\s+([A-Z0-9]{1,5})\s*\(/gi;
    let match;
    while ((match = holdingPattern.exec(query)) !== null) {
      const symbol = match[1].toUpperCase().trim();
      if (symbol.length >= 2 && symbol.length <= 5) {
        holdingsFromQuery.push(symbol);
      }
    }
    
    console.log(`📊 Extracted from "Research SYMBOL (" pattern: ${holdingsFromQuery.join(', ')}`);
    
    // Also check for company names
    const companyNameMap: Record<string, string> = {
      'BLACKBERRY': 'BB',
      'LIGHTSPEED': 'LSPD',
      'NETFLIX': 'NFLX',
      'APPLE': 'AAPL',
      'NVIDIA': 'NVDA',
      'TESLA': 'TSLA',
      'MICROSOFT': 'MSFT',
      'GOOGLE': 'GOOGL',
      'AMAZON': 'AMZN',
    };
    
    const upperQuery = query.toUpperCase();
    for (const [companyName, ticker] of Object.entries(companyNameMap)) {
      if (upperQuery.includes(companyName) && !holdingsFromQuery.includes(ticker)) {
        holdingsFromQuery.push(ticker);
      }
    }
    
    const uniqueHoldings = [...new Set(holdingsFromQuery)].sort();
    console.log(`\n✅ Final extracted holdings: ${uniqueHoldings.join(', ')}`);
    console.log(`   Total: ${uniqueHoldings.length} holdings\n`);
    
    // Expected from log
    const expected = ['JPM', 'AVGO', 'MSFT', 'META', 'NVDA', 'QQQ', 'VOO', 'GLDM', 'SLV', 'NFLX', 'BB', 'LSPD', 'IBIT'];
    console.log(`📋 Expected (from log): ${expected.join(', ')}`);
    
    const missing = expected.filter(h => !uniqueHoldings.includes(h));
    const extra = uniqueHoldings.filter(h => !expected.includes(h));
    
    if (missing.length > 0) {
      console.log(`⚠️  Missing: ${missing.join(', ')}`);
    }
    if (extra.length > 0) {
      console.log(`ℹ️  Extra: ${extra.join(', ')}`);
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
