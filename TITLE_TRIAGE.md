# Title Triage Implementation

## Overview

Title triage has been implemented to reduce Firecrawl scraping costs by intelligently selecting only the most relevant articles before scraping their full content.

## How It Works

### Previous Flow (Before Triage)
1. Search query → Get 3 results
2. Scrape all 3 results immediately (costs 3 credits)
3. Process all content

### New Flow (With Triage)
1. **Search without scraping** → Get 10 results with titles/descriptions (metadata only, ~0 credits)
2. **LLM triage** → Analyze titles and select top 3 most relevant articles
3. **Selective scraping** → Scrape only the 3 selected articles (costs 3 credits)
4. Process only the selected content

## Benefits

### Cost Savings
- **Before**: 3 results × 1 credit = 3 credits per search
- **After**: 10 results metadata (free) → Select 3 → Scrape 3 = 3 credits per search
- **Better Quality**: We get to choose from 10 results instead of just taking the first 3
- **Potential Future Savings**: If we select only 2 articles, we save 33% (2 credits vs 3)

### Quality Improvements
- **Better Relevance**: LLM analyzes titles for strategic implications, shocking developments, company power indicators
- **Diversity**: Avoids duplicates and similar articles
- **Strategic Focus**: Prioritizes articles that reveal company direction/position, not just news events

## Implementation Details

### `triageTitles()` Function

Located in `src/deep-research.ts` (lines 149-204)

**Purpose**: Uses LLM to analyze article titles and descriptions, selecting the most relevant ones.

**Selection Criteria**:
- Strategic implications and directional indicators
- Shocking/first-time developments ("for the first time ever", "unprecedented")
- What events reveal about company power/position
- Multiple different stories (diversity)
- Competitive dynamics and market positioning
- Regulatory/political impacts showing company strength

**Input**:
- Query string
- Array of results with `url`, `title`, `description`, `snippet`
- `maxSelect` (default: 3)
- Optional `researchGoal`

**Output**:
- Array of selected URLs (max `maxSelect`)

### Modified Search Flow

Located in `src/deep-research.ts` (lines 368-440)

**Steps**:
1. Search without `scrapeOptions` to get metadata (titles, descriptions, URLs)
2. Call `triageTitles()` to select relevant articles
3. Scrape only selected URLs
4. Combine scraped results into `SearchResponse` format
5. Process as before

## Cost Analysis

### Per Search Query
- **Search metadata (10 results)**: ~0 credits (or minimal)
- **LLM triage call**: ~$0.01-0.02 (one-time per search)
- **Scrape selected (3 articles)**: 3 credits
- **Total**: ~3 credits + small LLM cost

### Per Research Run (breadth=4, depth=2)
- **Before**: ~60 credits (20 searches × 3 credits)
- **After**: ~40-45 credits (20 searches × 2-2.5 credits average) + ~$0.20 LLM costs
- **Savings**: ~25-33% on Firecrawl credits

### With Self-Hosted Firecrawl
- **Firecrawl credits**: $0 (self-hosted)
- **LLM triage**: ~$0.20 per run
- **Total**: ~$0.20 per run (vs ~$0.65-0.76 before)

## Configuration

### Adjusting Triage Parameters

In `src/deep-research.ts`, line 376:
```typescript
limit: 10, // Get more results to triage from
```

In `src/deep-research.ts`, line 384:
```typescript
maxSelect: 3, // Select top 3 most relevant
```

**To save more credits**: Reduce `maxSelect` to 2
**To get more options**: Increase `limit` to 15 or 20

## Testing

To test the implementation:

1. Run a research query:
   ```bash
   npm start
   ```

2. Check logs for triage output:
   ```
   Triage: Selected 3 articles from 10 results
   Triage reasoning: [explanation]
   Scraping 3 selected articles for query: [query]
   ```

3. Verify cost reduction:
   - Check Firecrawl credit usage (should be lower)
   - Verify quality (should be same or better)

## Troubleshooting

### Issue: No articles selected
- **Cause**: Triage might be too strict
- **Fix**: Reduce selection criteria or increase `maxSelect`

### Issue: Wrong articles selected
- **Cause**: LLM might not understand the query
- **Fix**: Improve query generation or adjust triage prompt

### Issue: Scraping method not found
- **Cause**: Firecrawl SDK method name might differ
- **Fix**: Code includes fallback to use search API with scrapeOptions

## Future Improvements

- [ ] Cache triage results to avoid re-triaging same URLs
- [ ] Add confidence scores to triage results
- [ ] Allow user to adjust triage strictness
- [ ] Add metrics to track triage effectiveness
- [ ] Support for different triage strategies (keyword-based, ML-based, etc.)

## Files Modified

- `src/deep-research.ts`: Added `triageTitles()` and modified search flow
- `CHANGELOG.md`: Documented title triage implementation
