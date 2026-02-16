/**
 * Test Finnhub enriched data fetching for stocks
 * Usage: npx tsx --env-file=.env.local scripts/test-finnhub-enriched.ts [SYMBOL ...]
 */

import '../src/load-env';
import { getAllFinnhubDataForStock } from '../src/finnhub-data';
import { fetchEnrichedPriceFromFinnhub } from '../src/price-detection';

async function testStock(symbol: string) {
  console.log(`\n========== Testing ${symbol} ==========\n`);

  // Test raw Finnhub data
  console.log('1. Fetching all Finnhub data...');
  const finnhubData = await getAllFinnhubDataForStock(symbol);

  if (!finnhubData) {
    console.error(`Failed to fetch Finnhub data for ${symbol}`);
    return;
  }

  console.log('\n--- Quote ---');
  if (finnhubData.quote) {
    console.log(JSON.stringify(finnhubData.quote, null, 2));
  } else {
    console.log('No quote data');
  }

  console.log('\n--- Company News (last 7 days) ---');
  console.log(`Found ${finnhubData.news.length} news items`);
  finnhubData.news.slice(0, 3).forEach((n) => {
    const date = new Date(n.datetime * 1000).toLocaleDateString();
    console.log(`- ${n.headline} (${date}) - ${n.source}`);
  });

  console.log('\n--- Key Metrics ---');
  if (finnhubData.metrics?.metric) {
    const m = finnhubData.metrics.metric;
    // Raw marketCap unit from Finnhub may be millions or dollars; we show in billions for display
    if (m.marketCapitalization) {
      const mcDollars = m.marketCapitalization >= 1e9 ? m.marketCapitalization : m.marketCapitalization * 1e6;
      console.log(`Market Cap: $${(mcDollars / 1e9).toFixed(2)}B (raw: ${m.marketCapitalization})`);
    }
    if (m.peNormalizedAnnual) console.log(`P/E Ratio: ${m.peNormalizedAnnual.toFixed(2)}`);
    if (m.eps) console.log(`EPS: ${m.eps.toFixed(2)}`);
    if (m.beta) console.log(`Beta: ${m.beta.toFixed(2)}`);
    if (m['52WeekHigh']) console.log(`52W High: $${m['52WeekHigh'].toFixed(2)}`);
    if (m['52WeekLow']) console.log(`52W Low: $${m['52WeekLow'].toFixed(2)}`);
    if (m.dividendYieldIndicatedAnnual) console.log(`Dividend Yield: ${(m.dividendYieldIndicatedAnnual * 100).toFixed(2)}%`);
  } else {
    console.log('No metrics data');
  }

  console.log('\n--- Recent SEC Filings ---');
  console.log(`Found ${finnhubData.filings.length} filings`);
  finnhubData.filings.slice(0, 5).forEach((f) => {
    console.log(`- ${f.form} filed ${f.filedDate}`);
    console.log(`  Report: ${f.reportUrl}`);
  });

  console.log('\n--- Financials Reported ---');
  if (finnhubData.financials) {
    const f = finnhubData.financials;
    console.log(`Form: ${f.form}, Period: ${f.year} Q${f.quarter}`);
    console.log(`Filed: ${f.filedDate}`);
    console.log(`Period: ${f.startDate} to ${f.endDate}`);
    if (f.report.ic && f.report.ic.length > 0) {
      console.log('\nIncome Statement (sample):');
      f.report.ic.slice(0, 5).forEach((item) => {
        const value = typeof item.value === 'number' ? item.value.toLocaleString() : item.value;
        console.log(`  ${item.label}: ${value} ${item.unit}`);
      });
    }
  } else {
    console.log('No financials data');
  }

  console.log('\n--- Candles (7-day pricing) ---');
  if (finnhubData.candles && finnhubData.candles.s === 'ok' && finnhubData.candles.c) {
    const closes = finnhubData.candles.c;
    console.log(`Found ${closes.length} days of closing prices`);
    if (closes.length >= 2) {
      console.log(`  7d ago: $${closes[0].toFixed(2)}`);
      console.log(`  Today: $${closes[closes.length - 1].toFixed(2)}`);
      const changePercent = (((closes[closes.length - 1] - closes[0]) / closes[0]) * 100).toFixed(2);
      console.log(`  7d Change: ${changePercent}%`);
    }
  } else {
    console.log('No candle data or status not ok');
  }

  // Test enriched PriceData
  console.log('\n\n2. Testing enriched PriceData...');
  const priceData = await fetchEnrichedPriceFromFinnhub(symbol);

  if (!priceData) {
    console.error(`Failed to fetch enriched price data for ${symbol}`);
    return;
  }

  console.log('\n--- Enriched PriceData ---');
  console.log(JSON.stringify(priceData, null, 2));

  // Validation checklist
  console.log('\n--- Validation Checklist ---');
  const checks = [
    { name: 'Current Price', pass: priceData.currentPrice > 0 },
    { name: '7-day Price', pass: priceData.price7DaysAgo > 0 },
    { name: '7-day Change %', pass: Math.abs(priceData.changePercent) >= 0 && !Number.isNaN(priceData.changePercent) },
    { name: 'Market Cap', pass: !!priceData.marketCap },
    { name: 'P/E Ratio', pass: !!priceData.peRatio },
    { name: 'EPS', pass: !!priceData.eps },
    { name: 'Recent News', pass: !!priceData.recentNews && priceData.recentNews.length > 0 },
    { name: 'Recent Filings', pass: !!priceData.recentFilings && priceData.recentFilings.length > 0 },
    { name: 'Latest Earnings', pass: !!priceData.latestEarnings },
  ];

  checks.forEach((check) => {
    const status = check.pass ? '✓' : '✗';
    console.log(`${status} ${check.name}`);
  });
}

async function main() {
  const symbols = process.argv.slice(2);

  if (symbols.length === 0) {
    console.log('Testing default stocks: NVDA, AAPL');
    await testStock('NVDA');
    await testStock('AAPL');
  } else {
    for (const symbol of symbols) {
      await testStock(symbol.toUpperCase());
    }
  }

  console.log('\n========== Test Complete ==========\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
