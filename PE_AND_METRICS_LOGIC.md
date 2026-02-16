# P/E and Metrics Logic — What We Fetch

Quick reference for where numbers come from and why industry P/E might look wrong.

## In this repo (deep-research)

### Company-level only
- **P/E**: From Finnhub **basic financials** → `metric.peNormalizedAnnual`, exposed as `PriceData.peRatio`. Used in the news-brief financial context block. This is **company** P/E only (trailing, normalized annual — see Finnhub docs for exact definition).
- **Industry / sector P/E**: **Not fetched here.** We do not call any endpoint that returns industry or sector averages. If the user sees “industry P/E” or “sector P/E” in cards or copy, that comes from the **feed/earnings service** (e.g. chat-from-scratch), not from Finnhub in this repo.
- **Other metrics** (same Finnhub basic financials): EPS, beta, 52W high/low, dividend yield, market cap. All company-level.

### Market cap units
- Finnhub’s `metric.marketCapitalization` unit is not clearly documented. We treat values **≥ 1e9** as already in **dollars**; smaller values as **millions** and multiply by 1e6 so `PriceData.marketCap` is always in dollars. If you see wrong market caps, verify Finnhub’s actual unit and adjust the logic in `src/price-detection.ts`.

### Where it’s used
- `src/price-detection.ts`: builds `PriceData` (including `peRatio`, `marketCap`, `eps`, etc.) from Finnhub enriched data.
- `src/news-brief-openai.ts`: `buildFinancialContextBlock()` formats these into the “FINANCIAL CONTEXT” section of the prompt (e.g. “P/E: 28.5”).

## If industry or “other” P/Es are wrong

1. **Industry / sector P/E**  
   Fix in the service that **produces** those numbers (e.g. chat-from-scratch feed or earnings-recap). This repo only has company P/E from Finnhub.

2. **Company P/E looks wrong**  
   - Confirm it’s coming from Finnhub `peNormalizedAnnual` (e.g. log `PriceData.peRatio` in the news-brief path).  
   - Finnhub’s “normalized annual” may differ from “current price / LTM EPS” (e.g. different earnings basis or normalization). Cross-check with Finnhub docs or another source.

3. **Other numbers (EPS, beta, etc.)**  
   Same source: Finnhub basic financials in this repo. If something is off, verify against Finnhub’s API response and docs.

## Summary

| Metric           | Source in deep-research        | Industry/sector in deep-research |
|-----------------|--------------------------------|-----------------------------------|
| P/E             | Finnhub `peNormalizedAnnual`   | No — from feed/earnings service   |
| EPS, beta, etc. | Finnhub basic financials       | No                                |
| Market cap      | Finnhub `marketCapitalization` (units normalized in code) | No |
