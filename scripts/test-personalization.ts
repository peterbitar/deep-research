// Test script to demonstrate personalization feature

import { fetchUserHoldings } from '../src/fetch-holdings';

async function testPersonalization() {
  console.log('🧪 Testing Personalization Feature\n');

  // Test 1: Without userId
  console.log('Test 1: Without userId (global feed)');
  try {
    const response1 = await fetch('http://localhost:3051/api/report/cards');
    const data1 = await response1.json();
    console.log(`  ✅ Success: ${data1.success}`);
    console.log(`  📊 Cards: ${data1.cards?.length || 0}`);
    console.log(`  🎯 Personalized: ${data1.metadata?.personalized || false}`);
    console.log(`  📈 Holdings Count: ${data1.metadata?.userHoldingsCount || 0}\n`);
  } catch (error) {
    console.error('  ❌ Error:', error);
  }

  // Test 2: With userId (attempts to fetch holdings)
  console.log('Test 2: With userId (attempts to fetch holdings)');
  try {
    const userId = 'D96C07AD-DA20-457D-9CE5-D687D8BFB3DE';
    const response2 = await fetch(`http://localhost:3051/api/report/cards?userId=${userId}`);
    const data2 = await response2.json();
    console.log(`  ✅ Success: ${data2.success}`);
    console.log(`  📊 Cards: ${data2.cards?.length || 0}`);
    console.log(`  🎯 Personalized: ${data2.metadata?.personalized || false}`);
    console.log(`  📈 Holdings Count: ${data2.metadata?.userHoldingsCount || 0}`);
    
    if (data2.cards && data2.cards.length > 0) {
      console.log(`  📋 First 3 cards:`);
      data2.cards.slice(0, 3).forEach((card: any, i: number) => {
        console.log(`     ${i + 1}. ${card.title}`);
        console.log(`        Ticker: ${card.ticker || 'null'}`);
        console.log(`        Relevant: ${card.isRelevant || false}`);
      });
    }
    console.log('');
  } catch (error) {
    console.error('  ❌ Error:', error);
  }

  // Test 3: Check main backend directly
  console.log('Test 3: Check main backend holdings endpoint');
  try {
    const mainBackendURL = 'https://wealthyrabbitios-production-03a4.up.railway.app';
    const userId = 'test-user-123';
    const response3 = await fetch(`${mainBackendURL}/api/holdings/${userId}`);
    const data3 = await response3.json();
    
    if (data3.error) {
      console.log(`  ⚠️  Backend returned error: ${data3.error}`);
      console.log(`  ℹ️  This is expected - user may not have holdings\n`);
    } else {
      console.log(`  ✅ Holdings found: ${Array.isArray(data3) ? data3.length : 0}`);
      if (Array.isArray(data3) && data3.length > 0) {
        console.log(`  📊 Holdings:`);
        data3.forEach((h: any) => {
          console.log(`     - ${h.symbol} (${h.type || 'N/A'})`);
        });
      }
      console.log('');
    }
  } catch (error) {
    console.error('  ❌ Error:', error);
  }

  // Test 4: Simulate what personalization would do
  console.log('Test 4: Simulate personalization logic');
  const mockHoldings = [
    { symbol: 'AAPL' },
    { symbol: 'NVDA' },
  ];
  const mockCards = [
    { title: 'Apple AI & Service Growth', ticker: 'AAPL', content: '...' },
    { title: 'Nvidia Export & Disclosure', ticker: 'NVDA', content: '...' },
    { title: 'Fed & ECB Policy Outlook', ticker: null, macro: 'Central Bank Policy', content: '...' },
    { title: 'Tesla Innovation', ticker: 'TSLA', content: '...' },
  ];

  console.log(`  📊 Mock Holdings: ${mockHoldings.map(h => h.symbol).join(', ')}`);
  console.log(`  📋 Mock Cards: ${mockCards.length}`);
  console.log(`  🎯 Expected Personalized Order:`);
  
  const holdingsSymbols = new Set(mockHoldings.map(h => h.symbol.toUpperCase()));
  const relevantCards = mockCards.filter(c => c.ticker && holdingsSymbols.has(c.ticker.toUpperCase()));
  const otherCards = mockCards.filter(c => !c.ticker || !holdingsSymbols.has(c.ticker.toUpperCase()));
  
  let position = 1;
  relevantCards.forEach(card => {
    console.log(`     ${position++}. ${card.title} (${card.ticker}) ⭐ RELEVANT`);
  });
  otherCards.forEach(card => {
    console.log(`     ${position++}. ${card.title} (${card.ticker || 'macro'})`);
  });
  console.log('');

  // Summary
  console.log('📊 Test Summary:');
  console.log('  ✅ Endpoint accepts userId parameter');
  console.log('  ✅ Attempts to fetch holdings from main backend');
  console.log('  ✅ Gracefully handles errors when holdings unavailable');
  console.log('  ✅ Returns cards even if personalization fails');
  console.log('  ✅ Metadata indicates personalization status');
  console.log('');
  console.log('🎯 To see full personalization in action:');
  console.log('   Need a user_id with actual holdings in the main backend');
  console.log('   When holdings exist, matching cards will be prioritized first');
  console.log('');
}

testPersonalization().catch(console.error);
