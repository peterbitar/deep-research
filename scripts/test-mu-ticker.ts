// Test dynamic ticker detection for MU (Micron Technology)

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

// Test cases for MU
const testCases = [
  {
    title: 'MU earnings beat expectations',
    content: 'Micron Technology (MU) reported strong earnings this week, exceeding analyst expectations.',
    expectedTicker: 'MU'
  },
  {
    title: 'MU stock rises on memory chip demand',
    content: 'MU announced strong demand for memory chips that sent its stock price higher.',
    expectedTicker: 'MU'
  },
  {
    title: 'Micron Technology MU reports growth',
    content: 'MU, also known as Micron Technology, showed impressive growth in Q4.',
    expectedTicker: 'MU'
  },
  {
    title: '$MU surges on AI chip news',
    content: 'The stock $MU surged after announcing new AI memory solutions.',
    expectedTicker: 'MU'
  },
  {
    title: 'Multiple tickers: MU and NVDA',
    content: 'MU and NVDA both reported strong earnings this quarter related to AI demand.',
    expectedTickers: ['MU', 'NVDA']
  },
  {
    title: 'MU in parentheses',
    content: 'Micron (MU) announced a major expansion of its memory chip production facilities.',
    expectedTicker: 'MU'
  },
  {
    title: 'MU with comma separation',
    content: 'The semiconductor sector, including MU, AMD, and NVDA, showed strong performance.',
    expectedTickers: ['MU', 'AMD', 'NVDA']
  }
];

console.log('🧪 Testing MU (Micron Technology) Ticker Detection\n');

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  const combinedText = `${testCase.title.toUpperCase()} ${testCase.content.toUpperCase()}`;
  const detectedTickers = extractTickerSymbols(combinedText);
  
  const expectedTickers = testCase.expectedTickers || (testCase.expectedTicker ? [testCase.expectedTicker] : []);
  
  const hasExpectedTicker = expectedTickers.length === 0 
    ? detectedTickers.length === 0
    : expectedTickers.every(ticker => detectedTickers.includes(ticker));
  
  if (hasExpectedTicker) {
    console.log(`✅ PASS: "${testCase.title}"`);
    console.log(`   Detected: ${detectedTickers.join(', ') || 'none'}`);
    console.log(`   Expected: ${expectedTickers.join(', ') || 'none'}\n`);
    passed++;
  } else {
    console.log(`❌ FAIL: "${testCase.title}"`);
    console.log(`   Detected: ${detectedTickers.join(', ') || 'none'}`);
    console.log(`   Expected: ${expectedTickers.join(', ') || 'none'}`);
    console.log(`   Missing: ${expectedTickers.filter(t => !detectedTickers.includes(t)).join(', ')}\n`);
    failed++;
  }
}

console.log(`\n📊 Results: ${passed} passed, ${failed} failed`);

// Test with user holdings prioritization
console.log('\n\n🧪 Testing User Holdings Prioritization with MU\n');

const userHoldings = [
  { symbol: 'MU' },
  { symbol: 'NVDA' },
  { symbol: 'AMD' }
];

const holdingsSymbols = new Set(userHoldings.map(h => h.symbol.toUpperCase()));

const testText = 'MU, NVDA, and AMD all reported earnings. AAPL also had news.';
const detectedTickers = extractTickerSymbols(testText.toUpperCase());

console.log(`Test text: "${testText}"`);
console.log(`All detected tickers: ${detectedTickers.join(', ')}`);
console.log(`User holdings: ${Array.from(holdingsSymbols).join(', ')}`);

const prioritizedTickers = detectedTickers.filter(t => holdingsSymbols.has(t));
console.log(`Prioritized (user holdings): ${prioritizedTickers.join(', ')}`);
console.log(`Other tickers: ${detectedTickers.filter(t => !holdingsSymbols.has(t)).join(', ')}`);

if (prioritizedTickers.length > 0 && prioritizedTickers.includes('MU')) {
  console.log('\n✅ User holdings prioritization working correctly for MU!');
} else {
  console.log('\n❌ User holdings prioritization not working for MU');
}

// Test the actual determineCardMetadata function logic
console.log('\n\n🧪 Testing Full Card Metadata Detection Logic\n');

function determineCardMetadata(
  title: string, 
  content: string,
  userHoldings?: Array<{ symbol: string }>
): {
  ticker?: string;
  macro?: string;
} {
  const upperTitle = title.toUpperCase();
  const upperContent = content.toUpperCase();
  const combinedText = `${upperTitle} ${upperContent}`;
  
  // Extract potential tickers
  const potentialTickers = extractTickerSymbols(combinedText);
  
  // If user holdings provided, prioritize matching those
  if (userHoldings && userHoldings.length > 0) {
    const holdingsSymbols = new Set(userHoldings.map(h => h.symbol.toUpperCase()));
    for (const ticker of potentialTickers) {
      if (holdingsSymbols.has(ticker)) {
        return { ticker };
      }
    }
  }
  
  // Check for well-known tickers
  const wellKnownTickers = new Set(['NFLX', 'AAPL', 'NVDA', 'TSLA', 'MSFT', 'GOOGL', 'AMZN', 'META', 'BTC', 'ETH', 'SOL', 'BB', 'LSPD', 'CSU', 'MU', 'AMD']);
  for (const ticker of potentialTickers) {
    if (wellKnownTickers.has(ticker)) {
      return { ticker };
    }
  }
  
  // Use first potential ticker if it looks valid
  if (potentialTickers.length > 0 && !userHoldings) {
    const firstTicker = potentialTickers[0];
    if (firstTicker.length >= 2 && firstTicker.length <= 5) {
      return { ticker: firstTicker };
    }
  }
  
  return {};
}

const cardTests = [
  {
    title: 'MU earnings beat',
    content: 'Micron Technology (MU) reported strong earnings.',
    holdings: [{ symbol: 'MU' }],
    expectedTicker: 'MU'
  },
  {
    title: 'MU memory chip news',
    content: 'MU announced new memory chip technology.',
    holdings: [{ symbol: 'MU' }],
    expectedTicker: 'MU'
  }
];

for (const test of cardTests) {
  const result = determineCardMetadata(test.title, test.content, test.holdings);
  if (result.ticker === test.expectedTicker) {
    console.log(`✅ PASS: "${test.title}" → Ticker: ${result.ticker}`);
  } else {
    console.log(`❌ FAIL: "${test.title}" → Expected: ${test.expectedTicker}, Got: ${result.ticker || 'none'}`);
  }
}
