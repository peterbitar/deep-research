// Test the new TLDR style (3-4 sentences, no bullets)
import { writeFinalReport } from '../src/deep-research';

async function testNewTLDRStyle() {
  console.log('🧪 Testing New TLDR Style (3-4 sentences, no bullets)\n');

  const prompt = 'What happened with Netflix this week?';
  const learnings = [
    '[RECENT CHANGE] Netflix amended its merger agreement with Warner Bros. Discovery to an all-cash $82.7 billion deal on January 20, 2026.',
    '[RECENT CHANGE] Netflix reported Q4 2025 earnings with revenue up 18% to $12.05 billion.',
  ];
  const visitedUrls = [
    'https://www.sec.gov/Archives/edgar/data/1065280/000106528026000033/nflx-20260120.htm',
  ];

  console.log('📝 Generating report with new TLDR style...\n');
  const report = await writeFinalReport({ prompt, learnings, visitedUrls });

  // Extract TLDR from first card
  const cardHeaderRegex = /^##\s+([^\n]+)$/gm;
  const firstCardMatch = cardHeaderRegex.exec(report);
  
  if (firstCardMatch) {
    const headerEnd = firstCardMatch.index! + firstCardMatch[0].length;
    const nextCardMatch = cardHeaderRegex.exec(report);
    cardHeaderRegex.lastIndex = 0;
    const contentEnd = nextCardMatch ? nextCardMatch.index! : report.length;
    
    const cardContent = report.substring(headerEnd, contentEnd);
    const tldrMatch = cardContent.match(/^###\s+TLDR\s*\n(.*?)(?=\n\n|$)/is);
    
    if (tldrMatch) {
      const tldr = tldrMatch[1].trim();
      
      console.log('='.repeat(60));
      console.log('TLDR CONTENT');
      console.log('='.repeat(60));
      console.log(tldr);
      console.log('\n' + '-'.repeat(60));
      
      // Check format
      const hasBullets = /^[-*•]\s/.test(tldr) || /^\d+\.\s/.test(tldr);
      const isParagraph = !hasBullets && tldr.split('.').length >= 3;
      const hasAnalogy = /\b(like|similar to|as if|reminds me of|think of it as)\b/i.test(tldr);
      const hasQuote = /"[^"]+"/.test(tldr);
      
      console.log(`\n✅ Format Checks:`);
      console.log(`   No bullet points: ${!hasBullets ? 'YES ✅' : 'NO ❌'}`);
      console.log(`   Paragraph format: ${isParagraph ? 'YES ✅' : 'NO ❌'}`);
      console.log(`   Has analogy: ${hasAnalogy ? 'YES ✅' : 'NO ⚠️'}`);
      console.log(`   Has quote: ${hasQuote ? 'YES ✅' : 'NO ⚠️'}`);
      console.log(`   Sentence count: ${tldr.split('.').filter(s => s.trim()).length}`);
      
      const success = !hasBullets && isParagraph;
      console.log(`\n${success ? '🎉 SUCCESS: TLDR is in correct format!' : '❌ FAILED: TLDR format incorrect'}\n`);
      
      return { success, hasBullets, isParagraph };
    }
  }
  
  console.log('❌ No TLDR found in report\n');
  return { success: false };
}

testNewTLDRStyle()
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
