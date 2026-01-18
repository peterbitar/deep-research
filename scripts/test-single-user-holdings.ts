// Test fetching holdings for a single user
import { fetchUserHoldings } from '../src/fetch-holdings';

async function testSingleUser() {
  const userId = process.argv[2] || '352E5E8C-FE9D-4B6B-9465-A8DA7920CCA7';
  
  console.log(`📡 Fetching holdings for user: ${userId}\n`);
  
  try {
    const holdings = await fetchUserHoldings({ userId });
    
    console.log(`✅ Fetched ${holdings.length} holdings:\n`);
    holdings.forEach((h, i) => {
      console.log(`  ${i + 1}. ${h.symbol} (${h.type}): ${h.name}`);
    });
    
    // Test deduplication
    const seenSymbols = new Set<string>();
    const uniqueHoldings = holdings.filter(h => {
      const symbol = h.symbol.toUpperCase();
      if (seenSymbols.has(symbol)) {
        return false;
      }
      seenSymbols.add(symbol);
      return true;
    });
    
    const duplicatesRemoved = holdings.length - uniqueHoldings.length;
    if (duplicatesRemoved > 0) {
      console.log(`\n🔍 Deduplication: Removed ${duplicatesRemoved} duplicate(s)`);
    }
    
    console.log(`\n📊 Final unique holdings: ${uniqueHoldings.length}`);
  } catch (error) {
    console.error('❌ Error:', error instanceof Error ? error.message : String(error));
  }
}

testSingleUser().catch(console.error);
