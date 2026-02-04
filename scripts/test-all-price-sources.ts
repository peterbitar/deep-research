/**
 * Test all price sources: Finnhub, Alpha Vantage, SEC EDGAR, Yahoo
 * Usage: npx tsx --env-file=.env.local scripts/test-all-price-sources.ts [SYMBOL ...]
 */

import '../src/load-env';
import { getAllFinnhubDataForStock } from '../src/finnhub-data';
import { fetchEnrichedPriceFromFinnhub } from '../src/price-detection';
import { fetchAlphaVantageTimeSeries, fetchAlphaVantageQuote, fetchSECFilingsByTicker } from '../src/free-financial-apis';
import { getPriceDataForHolding } from '../src/price-detection';

async function testAllSources(symbol: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Testing all price sources for: ${symbol}`);
  console.log(`${'='.repeat(60)}\n`);

  // Test 1: Finnhub enriched
  console.log('1️⃣  FINNHUB ENRICHED DATA');
  console.log('-'.repeat(60));
  const finnhubPrice = await fetchEnrichedPriceFromFinnhub(symbol);
  if (finnhubPrice) {
    console.log(`  ✓ Price: $${finnhubPrice.currentPrice.toFixed(2)}`);
    console.log(`  ✓ 7-day: ${finnhubPrice.changePercent.toFixed(2)}% (${finnhubPrice.price7DaysAgo.toFixed(2)} → ${finnhubPrice.currentPrice.toFixed(2)})`);
    if (finnhubPrice.marketCap) console.log(`  ✓ Market Cap: $${(finnhubPrice.marketCap / 1e9).toFixed(2)}B`);
    if (finnhubPrice.peRatio) console.log(`  ✓ P/E Ratio: ${finnhubPrice.peRatio.toFixed(2)}`);
    if (finnhubPrice.eps) console.log(`  ✓ EPS: $${finnhubPrice.eps.toFixed(2)}`);
    if (finnhubPrice.recentNews && finnhubPrice.recentNews.length > 0) {
      console.log(`  ✓ Recent news: ${finnhubPrice.recentNews.length} headlines`);
    }
    if (finnhubPrice.recentFilings && finnhubPrice.recentFilings.length > 0) {
      console.log(`  ✓ Recent filings: ${finnhubPrice.recentFilings.length} filings`);
    }
  } else {
    console.log('  ✗ Finnhub enriched data not available (key not set or rate limited)');
  }

  // Test 2: Alpha Vantage
  console.log('\n2️⃣  ALPHA VANTAGE DATA');
  console.log('-'.repeat(60));
  const avQuote = await fetchAlphaVantageQuote(symbol);
  if (avQuote) {
    console.log(`  ✓ Current Price: $${avQuote.currentPrice.toFixed(2)}`);
    console.log(`  ✓ Previous Close: $${avQuote.previousClose.toFixed(2)}`);
  } else {
    console.log('  ✗ Alpha Vantage quote not available (key not set or rate limited)');
  }

  const avTimeSeries = await fetchAlphaVantageTimeSeries(symbol);
  if (avTimeSeries && avTimeSeries['Time Series (Daily)']) {
    const series = avTimeSeries['Time Series (Daily)'];
    const dates = Object.keys(series).sort().reverse();
    console.log(`  ✓ Time Series: ${dates.length} days of data available`);
    if (dates.length >= 7) {
      const currentClose = parseFloat(series[dates[0]]['4. close']);
      const sevenDayClose = parseFloat(series[dates[6]]['4. close']);
      const changePercent = (((currentClose - sevenDayClose) / sevenDayClose) * 100).toFixed(2);
      console.log(`  ✓ 7-day change: ${changePercent}% (${sevenDayClose.toFixed(2)} → ${currentClose.toFixed(2)})`);
    }
  } else {
    console.log('  ✗ Alpha Vantage time series not available (key not set or rate limited)');
  }

  // Test 3: SEC EDGAR Filings
  console.log('\n3️⃣  SEC EDGAR FILINGS (Free)');
  console.log('-'.repeat(60));
  const secFilings = await fetchSECFilingsByTicker(symbol, 5);
  if (secFilings.length > 0) {
    console.log(`  ✓ Found ${secFilings.length} recent SEC filings:`);
    secFilings.slice(0, 3).forEach((f) => {
      console.log(`    - ${f.form} filed on ${f.filingDate}`);
    });
  } else {
    console.log('  ✗ No SEC filings found (ticker not found or API error)');
  }

  // Test 4: Automatic fallback chain
  console.log('\n4️⃣  AUTOMATIC FALLBACK CHAIN');
  console.log('-'.repeat(60));
  const price = await getPriceDataForHolding(symbol);
  if (price) {
    console.log(`  ✓ Final Price Data:`);
    console.log(`    - Current Price: $${price.currentPrice.toFixed(2)}`);
    console.log(`    - 7-day Change: ${price.changePercent.toFixed(2)}%`);
    console.log(`    - 1-day Change: ${price.changePercent1d?.toFixed(2) ?? 'N/A'}%`);

    // Determine which source was used
    if (price.marketCap) {
      console.log(`    - Source: Finnhub (enriched) ✓`);
    } else if (price.changePercent !== 0) {
      console.log(`    - Source: Alpha Vantage (accurate 7-day data) ✓`);
    } else {
      console.log(`    - Source: Yahoo Finance (final fallback)`);
    }
  } else {
    console.log('  ✗ Failed to fetch price from any source');
  }

  console.log('\n' + '='.repeat(60));
}

async function main() {
  const symbols = process.argv.slice(2);

  if (symbols.length === 0) {
    console.log('Testing default stocks: NVDA, AAPL, MSFT');
    await testAllSources('NVDA');
    await testAllSources('AAPL');
    await testAllSources('MSFT');
  } else {
    for (const symbol of symbols) {
      await testAllSources(symbol.toUpperCase());
    }
  }

  console.log('\n✅ Test Complete\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
