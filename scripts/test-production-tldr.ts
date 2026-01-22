// Test per-card TLDR on production API
import axios from 'axios';

const PRODUCTION_URL = 'https://deep-research-production-0185.up.railway.app';

async function testProductionTLDR() {
  console.log('🧪 Testing Per-Card TLDR on Production API\n');
  console.log(`📍 Production URL: ${PRODUCTION_URL}\n`);

  try {
    // Test 1: Generate a report
    console.log('='.repeat(60));
    console.log('TEST 1: Generate Report with Per-Card TLDR');
    console.log('='.repeat(60));
    
    const generateResponse = await axios.post(
      `${PRODUCTION_URL}/api/generate-report-json`,
      {
        query: 'What happened with Netflix this week?',
        depth: 1,
        breadth: 2,
        includeMacro: false, // Skip macro for faster test
      },
      {
        timeout: 300000, // 5 minutes timeout
      }
    );

    if (generateResponse.data.success) {
      console.log('✅ Report generated successfully');
      console.log(`📊 Cards: ${generateResponse.data.cards?.length || 0}`);
      
      // Check for per-card TLDRs
      const cards = generateResponse.data.cards || [];
      let cardsWithTLDR = 0;
      
      for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const content = card.content || '';
        const hasTLDR = /###\s+TLDR/i.test(content);
        
        if (hasTLDR) {
          cardsWithTLDR++;
          console.log(`\n✅ Card ${i + 1}: "${card.title}"`);
          console.log(`   TLDR: PRESENT`);
          
          // Extract TLDR preview
          const tldrMatch = content.match(/###\s+TLDR\s*\n(.*?)(?=\n\n|$)/is);
          if (tldrMatch) {
            const tldrPreview = tldrMatch[1].trim().substring(0, 150);
            console.log(`   Preview: ${tldrPreview}...`);
          }
        } else {
          console.log(`\n❌ Card ${i + 1}: "${card.title}"`);
          console.log(`   TLDR: MISSING`);
        }
      }
      
      console.log(`\n📊 Summary: ${cardsWithTLDR}/${cards.length} cards have TLDR sections`);
      
      // Test 2: Get report cards
      console.log('\n' + '='.repeat(60));
      console.log('TEST 2: Get Report Cards (Verify TLDR in Response)');
      console.log('='.repeat(60));
      
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const cardsResponse = await axios.get(`${PRODUCTION_URL}/api/report/cards`);
      
      if (cardsResponse.data.success) {
        console.log('✅ Report cards retrieved successfully');
        const apiCards = cardsResponse.data.cards || [];
        
        let apiCardsWithTLDR = 0;
        for (let i = 0; i < apiCards.length; i++) {
          const card = apiCards[i];
          const content = card.content || '';
          const hasTLDR = /###\s+TLDR/i.test(content);
          
          if (hasTLDR) {
            apiCardsWithTLDR++;
          }
        }
        
        console.log(`📊 Cards from API: ${apiCards.length}`);
        console.log(`📊 Cards with TLDR: ${apiCardsWithTLDR}/${apiCards.length}`);
        
        if (apiCardsWithTLDR === apiCards.length && apiCards.length > 0) {
          console.log('\n🎉 SUCCESS: All cards have per-card TLDR sections!');
          return { success: true };
        } else {
          console.log('\n⚠️  WARNING: Some cards missing TLDR');
          return { success: false };
        }
      } else {
        console.log('❌ Failed to retrieve report cards');
        return { success: false };
      }
    } else {
      console.log('❌ Report generation failed');
      console.log('Response:', generateResponse.data);
      return { success: false };
    }
  } catch (error: any) {
    console.error('❌ Test failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return { success: false };
  }
}

testProductionTLDR()
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Test error:', error);
    process.exit(1);
  });
