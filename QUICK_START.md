# Quick Start Guide

## 30-Second Setup

### Minimum (Free - Yahoo only):
```bash
# Just run - no setup needed
npm run news-brief
```

### Better (Free - Add Alpha Vantage):
```bash
# 1. Get free key: https://www.alphavantage.co/
# 2. Add to .env.local:
echo "ALPHA_VANTAGE_KEY=your-key" >> .env.local

# 3. Run
npm run news-brief
```

### Best (Add Finnhub):
```bash
# 1. Get Finnhub key: https://finnhub.io/register
# 2. Add to .env.local:
echo "FINNHUB_KEY=your-key" >> .env.local
echo "ALPHA_VANTAGE_KEY=your-alpha-key" >> .env.local

# 3. Run
npm run news-brief
```

## Testing

```bash
# Test all price sources
npx tsx --env-file=.env.local scripts/test-all-price-sources.ts AAPL MSFT NVDA

# Test news brief with stocks
RESEARCH_SYMBOLS=NVDA,MSFT npm run news-brief

# Test crypto (no regression)
RESEARCH_SYMBOLS=BTC,ETH npm run news-brief
```

## What Changed

| Before | After |
|--------|-------|
| Yahoo Finance (2 data points) | Finnhub → Alpha Vantage → Yahoo |
| 7-day % = 0% | 7-day % = accurate (5.51%, etc.) |
| No news/filings | Company news + SEC filings |
| No metrics | P/E, market cap, EPS, beta |

## Cost Breakdown

- **Free**: Yahoo Finance (works, less accurate)
- **Free**: Alpha Vantage key (25 req/day, better 7-day pricing)
- **Free**: SEC EDGAR (unlimited filings)
- **Optional $0-50/month**: Finnhub (best enriched data)

## Files to Check

- `FINNHUB_INTEGRATION.md` - Finnhub details
- `FREE_APIS_INTEGRATION.md` - Alpha Vantage + SEC EDGAR details
- `IMPLEMENTATION_COMPLETE.md` - Full technical overview

## Environment Variables

```bash
# Add to .env.local or Railway variables

# Optional: Better free pricing (25 req/day)
ALPHA_VANTAGE_KEY=your-key

# Optional: Best enriched data (news, filings, metrics)
FINNHUB_KEY=your-key

# Optional: Better crypto prices
FREECRYPTOAPI_KEY=your-key

# Required (existing)
OPENAI_KEY=sk-...
DATABASE_URL=postgresql://...
```

## Validation

✅ All tests passing
✅ No regressions (crypto still works)
✅ Fallback chain working
✅ 7-day pricing accurate
✅ Financial context injected

## Questions?

See full documentation:
- `FINNHUB_INTEGRATION.md` - Finnhub Q&A
- `FREE_APIS_INTEGRATION.md` - Alpha Vantage + SEC EDGAR Q&A
- `IMPLEMENTATION_COMPLETE.md` - Technical details
