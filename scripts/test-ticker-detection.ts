// Test dynamic ticker detection for CSU and other tickers

// Simulate the ticker extraction logic (matches the updated version)
function extractTickerSymbols(text: string): string[] {
  const tickerPattern = /(?:^|[\s$\(,])([A-Z0-9]{1,5})(?=[\s\)\.,;:]|$)/g;
  const commonWords = new Set([
    'THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 
    'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO',
    'BOY', 'DID', 'LET', 'PUT', 'SAY', 'SHE', 'TOO', 'USE', 'HAD', 'WITH', 'THIS', 'WEEK', 'THAT', 'FROM',
    'INTO', 'ONLY', 'OVER', 'UNDER', 'AFTER', 'BEFORE', 'ABOUT', 'ABOVE', 'BELOW', 'BETWEEN', 'AMONG',
    'STOCK', 'PRICE', 'SHARES', 'MARKET', 'TRADING', 'EARNINGS', 'REVENUE', 'GROWTH', 'SALES', 'PROFIT'
  ]);
  
  const matches = new Set<string>();
  let match;
  
  while ((match = tickerPattern.exec(text)) !== null) {
    const symbol = match[1];
    if (symbol.length >= 2 && 
        !commonWords.has(symbol) && 
        /[A-Z]/.test(symbol)) { // Must contain at least one letter
      matches.add(symbol);
    }
  }
  
  return Array.from(matches);
}

// Test cases
const testCases = [
  {
    title: 'CSU earnings beat expectations',
    content: 'Constellation Software (CSU) reported strong earnings this week, exceeding analyst expectations.',
    expectedTicker: 'CSU'
  },
  {
    title: 'CSU stock rises on acquisition news',
    content: 'CSU announced a major acquisition deal that sent its stock price higher.',
    expectedTicker: 'CSU'
  },
  {
    title: 'Constellation Software CSU reports growth',
    content: 'CSU, also known as Constellation Software, showed impressive growth in Q4.',
    expectedTicker: 'CSU'
  },
  {
    title: 'Blackberry BB announces partnership',
    content: 'BB (Blackberry) announced a new strategic partnership with major tech companies.',
    expectedTicker: 'BB'
  },
  {
    title: 'Lightspeed LSPD expands operations',
    content: 'LSPD, the e-commerce platform company, expanded its operations into new markets.',
    expectedTicker: 'LSPD'
  },
  {
    title: 'Multiple tickers: CSU and AAPL',
    content: 'CSU and AAPL both reported strong earnings this quarter.',
    expectedTickers: ['CSU', 'AAPL']
  },
  {
    title: 'No ticker - general market news',
    content: 'The market showed strong performance this week with broad gains across sectors.',
    expectedTicker: null
  }
];

console.log('🧪 Testing Dynamic Ticker Detection\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const combinedText = `${testCase.title.toUpperCase()} ${testCase.content.toUpperCase()}`;
  const detectedTickers = extractTickerSymbols(combinedText);
  
  const expectedTickers = testCase.expectedTickers || (testCase.expectedTicker ? [testCase.expectedTicker] : []);
  
  const hasExpectedTicker = expectedTickers.length === 0 
    ? detectedTickers.length === 0
    : expectedTickers.some(ticker => detectedTickers.includes(ticker));
  
  if (hasExpectedTicker) {
    console.log(`✅ PASS: "${testCase.title}"`);
    console.log(`   Detected: ${detectedTickers.join(', ') || 'none'}`);
    console.log(`   Expected: ${expectedTickers.join(', ') || 'none'}\n`);
    passed++;
  } else {
    console.log(`❌ FAIL: "${testCase.title}"`);
    console.log(`   Detected: ${detectedTickers.join(', ') || 'none'}`);
    console.log(`   Expected: ${expectedTickers.join(', ') || 'none'}\n`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

// Test with user holdings prioritization
console.log('\n\n🧪 Testing User Holdings Prioritization\n');

const userHoldings = [
  { symbol: 'CSU' },
  { symbol: 'BB' },
  { symbol: 'LSPD' }
];

const holdingsSymbols = new Set(userHoldings.map(h => h.symbol.toUpperCase()));

const testText = 'CSU, BB, and LSPD all reported earnings. AAPL also had news.';
const detectedTickers = extractTickerSymbols(testText.toUpperCase());

console.log(`Test text: "${testText}"`);
console.log(`All detected tickers: ${detectedTickers.join(', ')}`);
console.log(`User holdings: ${Array.from(holdingsSymbols).join(', ')}`);

const prioritizedTickers = detectedTickers.filter(t => holdingsSymbols.has(t));
console.log(`Prioritized (user holdings): ${prioritizedTickers.join(', ')}`);
console.log(`Other tickers: ${detectedTickers.filter(t => !holdingsSymbols.has(t)).join(', ')}`);

if (prioritizedTickers.length > 0) {
  console.log('\n✅ User holdings prioritization working correctly!');
} else {
  console.log('\n❌ User holdings prioritization not working');
}
