// Quick test for per-card TLDR feature
import { writeFinalReport } from '../src/deep-research';

async function testPerCardTLDR() {
  console.log('🧪 Testing Per-Card TLDR Feature\n');

  const prompt = 'What happened with Netflix this week?';
  const learnings = [
    '[RECENT CHANGE] Netflix amended its merger agreement with Warner Bros. Discovery to an all-cash $82.7 billion deal on January 20, 2026.',
    '[RECENT CHANGE] Netflix reported Q4 2025 earnings with revenue up 18% to $12.05 billion and subscriber count reaching 325 million.',
    '[RECENT CHANGE] Netflix is increasing program spending by 10% in 2026, which may impact profit margins despite strong subscriber growth.',
    '[RECENT CHANGE] Netflix stock rose 5% following the earnings announcement but then dropped 3% on concerns about margin guidance.',
  ];
  const visitedUrls = [
    'https://www.sec.gov/Archives/edgar/data/1065280/000106528026000033/nflx-20260120.htm',
    'https://www.bloomberg.com/news/articles/2026-01-20/netflix-to-boost-spending-on-programs-in-2026-crimping-profit',
  ];

  console.log(`📝 Prompt: ${prompt}`);
  console.log(`📚 Learnings: ${learnings.length}`);
  console.log(`🔗 URLs: ${visitedUrls.length}\n`);

  console.log('📝 Generating report with per-card TLDR...\n');

  const report = await writeFinalReport({
    prompt,
    learnings,
    visitedUrls,
  });

  // Check for per-card TLDRs
  const cardHeaderRegex = /^##\s+([^\n]+)$/gm;
  const cardMatches: Array<{ title: string; hasTLDR: boolean; tldrContent?: string }> = [];
  let match;

  while ((match = cardHeaderRegex.exec(report)) !== null) {
    const title = match[1].trim();
    if (title.toUpperCase() === 'SOURCES' || title.toUpperCase().includes('TLDR')) {
      continue;
    }

    // Find the content after this card header
    const headerEnd = match.index! + match[0].length;
    const nextCardMatch = cardHeaderRegex.exec(report);
    const contentEnd = nextCardMatch ? nextCardMatch.index! : report.length;
    cardHeaderRegex.lastIndex = 0; // Reset regex
    
    const cardContent = report.substring(headerEnd, contentEnd);
    
    // Check for TLDR section (### TLDR)
    const tldrMatch = cardContent.match(/^###\s+TLDR\s*\n(.*?)(?=\n\n|$)/is);
    const hasTLDR = !!tldrMatch;
    const tldrContent = tldrMatch ? tldrMatch[1].trim() : undefined;

    cardMatches.push({
      title,
      hasTLDR,
      tldrContent,
    });
  }

  console.log('='.repeat(60));
  console.log('TEST RESULTS');
  console.log('='.repeat(60));
  console.log(`📊 Total Cards Found: ${cardMatches.length}\n`);

  let allCardsHaveTLDR = true;
  for (let i = 0; i < cardMatches.length; i++) {
    const card = cardMatches[i];
    const status = card.hasTLDR ? '✅' : '❌';
    console.log(`${status} Card ${i + 1}: "${card.title}"`);
    console.log(`   TLDR Present: ${card.hasTLDR ? 'YES' : 'NO'}`);
    
    if (card.hasTLDR && card.tldrContent) {
      const preview = card.tldrContent.substring(0, 150);
      console.log(`   TLDR Preview: ${preview}...`);
    }
    console.log();
    
    if (!card.hasTLDR) {
      allCardsHaveTLDR = false;
    }
  }

  // Check for old-style global TLDR (should NOT be present)
  const globalTLDR = /^##\s+TLDR\s*$/m.test(report);
  console.log(`📋 Global TLDR (old style): ${globalTLDR ? 'FOUND ⚠️' : 'NOT FOUND ✅'}`);
  console.log(`   Expected: NOT FOUND (we want per-card TLDRs, not global)`);

  // Save report
  const fs = await import('fs/promises');
  const path = await import('path');
  const reportPath = path.join(process.cwd(), 'test-results', 'test-per-card-tldr.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report, 'utf-8');

  console.log(`\n✅ Report saved to: ${reportPath}`);
  console.log(`\n${allCardsHaveTLDR && !globalTLDR ? '🎉 SUCCESS: All cards have TLDR sections!' : '❌ FAILED: Some cards missing TLDR or global TLDR found'}\n`);

  return { 
    allCardsHaveTLDR, 
    cardCount: cardMatches.length,
    globalTLDR,
    success: allCardsHaveTLDR && !globalTLDR && cardMatches.length > 0
  };
}

testPerCardTLDR()
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
