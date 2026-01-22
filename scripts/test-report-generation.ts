// Quick test for report generation with TLDR
import { writeFinalReport } from '../src/deep-research';

async function testReportGeneration() {
  console.log('🧪 Testing Report Generation with TLDR\n');

  const prompt = 'What happened with Netflix this week?';
  const learnings = [
    '[RECENT CHANGE] Netflix amended its merger agreement with Warner Bros. Discovery to an all-cash $82.7 billion deal on January 20, 2026.',
    '[RECENT CHANGE] Netflix reported Q4 2025 earnings with revenue up 18% to $12.05 billion and subscriber count reaching 325 million.',
    '[RECENT CHANGE] Netflix is increasing program spending by 10% in 2026, which may impact profit margins despite strong subscriber growth.',
  ];
  const visitedUrls = [
    'https://www.sec.gov/Archives/edgar/data/1065280/000106528026000033/nflx-20260120.htm',
    'https://www.bloomberg.com/news/articles/2026-01-20/netflix-to-boost-spending-on-programs-in-2026-crimping-profit',
  ];

  console.log(`📝 Prompt: ${prompt}`);
  console.log(`📚 Learnings: ${learnings.length}`);
  console.log(`🔗 URLs: ${visitedUrls.length}\n`);

  console.log('📝 Generating report with TLDR...\n');

  const report = await writeFinalReport({
    prompt,
    learnings,
    visitedUrls,
  });

  // Check for TLDR
  const hasTLDR = /##\s+TLDR/i.test(report);
  const tldrMatch = report.match(/##\s+TLDR\s*\n(.*?)(?=\n##|$)/is);

  console.log('=' .repeat(60));
  console.log('TEST RESULTS');
  console.log('=' .repeat(60));
  console.log(`✅ TLDR Present: ${hasTLDR ? 'YES' : 'NO'}`);
  console.log(`📊 Report Length: ${report.length} characters`);
  console.log(`📄 Report Lines: ${report.split('\n').length}\n`);

  if (tldrMatch) {
    console.log('✅ TLDR CONTENT:');
    console.log('-'.repeat(60));
    console.log(tldrMatch[0].substring(0, 500));
    console.log('-'.repeat(60));
  } else {
    console.log('❌ TLDR NOT FOUND IN REPORT');
    console.log('\nFirst 800 chars of report:');
    console.log(report.substring(0, 800));
  }

  // Check for cards
  const cardMatches = report.match(/^##\s+[^\n]+$/gm);
  const cardCount = cardMatches ? cardMatches.filter(c => !c.includes('TLDR') && !c.includes('Sources')).length : 0;
  console.log(`\n📊 Cards Found: ${cardCount}`);

  // Save report
  const fs = await import('fs/promises');
  const path = await import('path');
  const reportPath = path.join(process.cwd(), 'test-results', 'test-report-generation.md');
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, report, 'utf-8');

  console.log(`\n✅ Report saved to: ${reportPath}`);
  console.log(`\n${hasTLDR ? '🎉 SUCCESS: TLDR is included!' : '❌ FAILED: TLDR is missing'}\n`);

  return { hasTLDR, reportLength: report.length, cardCount };
}

testReportGeneration()
  .then((result) => {
    process.exit(result.hasTLDR ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
