# Pipeline Architecture (MVP)

This document describes the new pipeline architecture that integrates with the existing deep research system.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    NEW PIPELINE (MVP)                        │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  1. Ingest + Title Triage                                    │
│     └─> Scheduled keyword/ticker searches (Firecrawl)        │
│                                                               │
│  2. Content Scoring                                          │
│     └─> Score articles on:                                   │
│         - Impact (1-10)                                      │
│         - Relevance to Holdings (0-1)                        │
│         - Time Relevance (boolean)                           │
│         - Source Quality (0-1)                               │
│                                                               │
│  3. Holdings Matching                                        │
│     └─> Match articles to user holdings:                     │
│         - Symbol-based (AAPL, NVDA)                          │
│         - Entity matching (Apple Inc., NVIDIA Corp)          │
│                                                               │
│  4. Trigger Agent                                            │
│     └─> Decide if deep research needed:                      │
│         - Auto-trigger: High impact + rejected               │
│         - Auto-trigger: No articles for top holdings         │
│         - Ask user: Mid-impact, weak matches                 │
│                                                               │
└─────────────────────────────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────┐
│          EXISTING DEEP RESEARCH (Stage 1-3)                  │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  Stage 1: Generate SERP queries                             │
│  Stage 2: Triage + Smart filter                             │
│  Stage 3: Scrape + Process + Generate learnings             │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

## Modules

### 1. Content Scoring (`src/content-scoring.ts`)
- Scores articles on Impact (1-10), Relevance (0-1), Time Relevance, Source Quality
- Uses LLM to evaluate impact based on earnings, lawsuits, regulatory changes, etc.
- Calculates composite score for filtering

### 2. Holdings Matching (`src/holdings-matching.ts`)
- Symbol-based matching (fast, high precision)
- Entity matching (Apple Inc., NVIDIA Corporation)
- Returns match results with confidence scores

### 3. Trigger Agent (`src/trigger-agent.ts`)
- Evaluates if deep research should be triggered
- Auto-triggers for high-impact rejected articles
- Auto-triggers if no articles found for top holdings
- Asks user for mid-impact, weak-match cases

### 4. Price Detection (`src/price-detection.ts`)
- Fetches 7-day price data from Yahoo Finance API
- Detects significant price moves (>5%)
- Triggers deep research for unexplained moves

## Integration Points

The new pipeline integrates with existing code:
- Uses existing `triageTitles` function (or similar logic)
- Triggers existing `deepResearch` function when needed
- Uses existing holdings parsing from `src/holdings.ts`

## Next Steps

1. Create pipeline orchestrator that ties modules together
2. Create scheduled search system (MVP: manual trigger, post-MVP: cron)
3. Integrate with existing deep research system
4. Add user interaction for trigger agent decisions
