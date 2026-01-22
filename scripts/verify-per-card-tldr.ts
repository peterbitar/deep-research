// Verify per-card TLDR in the actual report generation
import { writeFinalReport } from '../src/deep-research';

async function verifyPerCardTLDR() {
  console.log('🔍 Verifying Per-Card TLDR in Full Report Generation\n');

  const prompt = 'What happened with Netflix this week?';
  const learnings = [
    '[RECENT CHANGE] Netflix amended its merger agreement with Warner Bros. Discovery to an all-cash $82.7 billion deal on January 20, 2026.',
    '[RECENT CHANGE] Netflix reported Q4 2025 earnings with revenue up 18% to $12.05 billion and subscriber count reaching 325 million.',
  ];
  const visitedUrls = [
    'https://www.sec.gov/Archives/edgar/data/1065280/000106528026000033/nflx-20260120.htm',
  ];

  console.log('📝 Generating report...\n');
  const report = await writeFinalReport({ prompt, learnings, visitedUrls });

  // Parse cards and check for TLDR
  const cardHeaderRegex = /^##\s+([^\n]+)$/gm;
  const cards: Array<{ title: string; hasTLDR: boolean; tldrContent?: string }> = [];
  let match;

  while ((match = cardHeaderRegex.exec(report)) !== null) {
    const title = match[1].trim();
    if (title.toUpperCase() === 'SOURCES' || title.toUpperCase().includes('TLDR')) {
      continue;
    }

    const headerEnd = match.index! + match[0].length;
    const nextMatch = cardHeaderRegex.exec(report);
    cardHeaderRegex.lastIndex = 0; // Reset
    const contentEnd = nextMatch ? nextMatch.index! : report.length;
    
    const cardContent = report.substring(headerEnd, contentEnd);
    const tldrMatch = cardContent.match(/^###\s+TLDR\s*\n(.*?)(?=\n\n|$)/is);
    
    cards.push({
      title,
      hasTLDR: !!tldrMatch,
      tldrContent: tldrMatch ? tldrMatch[1].trim() : undefined,
    });
  }

  console.log('='.repeat(60));
  console.log('VERIFICATION RESULTS');
  console.log('='.repeat(60));
  console.log(`📊 Total Cards: ${cards.length}\n`);

  let allHaveTLDR = true;
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const status = card.hasTLDR ? '✅' : '❌';
    console.log(`${status} Card ${i + 1}: "${card.title}"`);
    console.log(`   TLDR: ${card.hasTLDR ? 'PRESENT' : 'MISSING'}`);
    
    if (card.hasTLDR && card.tldrContent) {
      const preview = card.tldrContent.substring(0, 200);
      console.log(`   Preview: ${preview}...`);
    }
    console.log();
    
    if (!card.hasTLDR) allHaveTLDR = false;
  }

  // Check for old global TLDR (should not exist)
  const hasGlobalTLDR = /^##\s+TLDR\s*$/m.test(report);
  console.log(`📋 Global TLDR (old): ${hasGlobalTLDR ? 'FOUND ⚠️' : 'NOT FOUND ✅'}`);

  console.log(`\n${allHaveTLDR && !hasGlobalTLDR && cards.length > 0 ? '🎉 SUCCESS: All cards have per-card TLDRs!' : '❌ FAILED'}\n`);

  // Show sample structure
  if (cards.length > 0 && cards[0].hasTLDR) {
    console.log('='.repeat(60));
    console.log('SAMPLE CARD STRUCTURE');
    console.log('='.repeat(60));
    const sampleStart = report.indexOf(`##`);
    const sampleEnd = Math.min(sampleStart + 800, report.length);
    console.log(report.substring(sampleStart, sampleEnd) + '...\n');
  }

  return { success: allHaveTLDR && !hasGlobalTLDR && cards.length > 0, cardCount: cards.length };
}

verifyPerCardTLDR()
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Verification failed:', error);
    process.exit(1);
  });
