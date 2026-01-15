# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased] - 2026-01-13

### Added
- **Smart Scraping Filter**: Intelligent post-triage filtering to further reduce scraping costs
  - Added `filterScrapeNeeds()` function that analyzes triaged articles to determine scraping necessity
  - Groups similar/duplicate stories and picks best source per group (Tier 1 preferred)
  - Determines if articles need full scraping or if metadata (title/description) is sufficient
  - Only scrapes articles missing critical data (prices, metrics, filings, detailed analysis)
  - Uses metadata-only for duplicates, simple events, and articles where title/description has key info
  - **Cost savings**: Reduces scraping by 30-50% (tested: 44% reduction on silver research)
  - **Files modified**: `src/deep-research.ts`
- **Research Quality Improvements**: Major enhancements to address critical gaps in research output
  - **Strict 7-day window enforcement**: System now enforces "last 7 days only" rule, clearly separating recent changes from long-term trends
  - **Tier 1 source prioritization**: System now prioritizes Reuters, Bloomberg, FT, WSJ, SEC filings, EIA data, OPEC statements over consulting blogs and aggregators
  - **Price/market fundamentals for commodities**: System now requires current prices, supply/demand balance, inventory levels, OPEC behavior for energy/commodity queries
  - **"What didn't change" grounding**: System now requires explicit statements about what remains stable to provide context
  - **Economic fundamentals focus**: System prioritizes margins, cash flow, capital returns over tech buzzwords (AI, IoT, digitalization)
  - **Holdings-level impact**: System now requires explicit implications for holders (bullish/neutral/bearish, near-term vs long-term, risk changes)
  - **Signal vs noise separation**: System now flags learnings as [RECENT CHANGE], [LONG-TERM TREND], or [CONTEXT]
  - **Files modified**: `src/prompt.ts`, `src/deep-research.ts`
- **Title Triage System**: Implemented intelligent title-based filtering to reduce scraping costs
  - Added `triageTitles()` function that uses LLM to analyze article titles and select most relevant ones
  - Modified search flow to get metadata (titles/descriptions) first without scraping
  - Only scrapes selected articles after triage, reducing costs by 30-50%
  - Searches 10 results, triages to select top 3 most relevant, then scrapes only those
  - **File**: `src/deep-research.ts` (lines 148-200, 368-440)
  - **Cost Impact**: Reduces Firecrawl credits from ~60 to ~30-40 per run (breadth=4, depth=2)
- **Self-hosted Firecrawl support**: Added Firecrawl service to `docker-compose.yml` to enable free, self-hosted web scraping
  - Firecrawl runs on port 3002
  - Updated `.env.local` to use `FIRECRAWL_BASE_URL` instead of API key
  - Deep research container now depends on Firecrawl service
- **Comprehensive changelog**: Created `CHANGELOG.md` to document all project changes

### Changed
- **Firecrawl configuration**: Switched from cloud API to self-hosted instance
  - Commented out `FIRECRAWL_KEY` in `.env.local`
  - Added `FIRECRAWL_BASE_URL="http://firecrawl:3002"` for Docker networking
  - For local (non-Docker) usage, use `http://localhost:3002`

---

## [Previous Changes] - Summary of All Modifications

### Cost Optimization Changes

#### Credit Usage Reduction
- **Reduced Firecrawl search limit**: Changed from 5 to 3 results per search query
  - **File**: `src/deep-research.ts` (line 317)
  - **Impact**: Reduced Firecrawl credits from ~100 to ~60 per run (breadth=4, depth=2)
  - **Cost savings**: ~40% reduction in Firecrawl API costs
  - **Date**: 2026-01-13

#### Retry Logic Implementation
- **Added exponential backoff retry mechanism** for Firecrawl API calls
  - **File**: `src/deep-research.ts` (lines 39-93)
  - **Features**:
    - Handles rate limit errors (429) with exponential backoff
    - Handles server errors (500, 502, 503) with retries
    - Extracts `retry-after` headers from error messages
    - Maximum 3 retries with increasing delays (2s → 4s → 8s, capped at 60s)
    - Explicitly does NOT retry on insufficient credits (402)
  - **Configuration**:
    - `MAX_RETRIES = 3`
    - `INITIAL_RETRY_DELAY = 2000ms`
    - `MAX_RETRY_DELAY = 60000ms`
  - **Date**: 2026-01-13

### Report Styling & Content Improvements

#### Wealthy Rabbit Persona Implementation
- **Created `reportStylePrompt()` function**: Comprehensive prompt for conversational, dramatic report writing
  - **File**: `src/prompt.ts` (lines 27-98)
  - **Style characteristics**:
    - Conversational tone (explaining to a friend with zero finance background)
    - Simple language with immediate jargon explanations
    - Card structure: Each topic gets its own clearly separated card
    - Self-contained stories within each card
    - Natural narrative flow (no formulaic structures)
    - Dramatic language when appropriate
    - Emoji section markers (🌍, 📊, 💼, 🏛️, 🤖, 🏦, 📈, 🟠, etc.)
  - **Date**: 2026-01-13

#### Report Generation Updates
- **Modified `writeFinalReport()`**: Now uses `reportStylePrompt()` for consistent styling
  - **File**: `src/deep-research.ts` (lines 196-239)
  - **Changes**:
    - Uses `reportStylePrompt()` instead of generic system prompt
    - Enforces card structure in prompt instructions
    - Emphasizes natural storytelling and dramatic elements
  - **Date**: 2026-01-13

### Research Quality Improvements

#### Enhanced Query Generation
- **Updated `generateSerpQueries()` prompt**: Focus on strategic implications and directional indicators
  - **File**: `src/deep-research.ts` (lines 96-147)
  - **Improvements**:
    - Looks for strategic implications (where company is heading)
    - Identifies what events reveal about company power/position
    - Captures competitive dynamics and market positioning
    - Focuses on multiple stories/events, not just one angle
    - Prioritizes shocking/first-time developments ("for the first time ever", "unprecedented", etc.)
  - **Date**: 2026-01-13

#### Enhanced Learning Extraction
- **Updated `processSerpResult()` prompt**: Better extraction of strategic insights
  - **File**: `src/deep-research.ts` (lines 149-194)
  - **Improvements**:
    - Focuses on strategic implications and company power/position
    - Extracts directional indicators
    - Captures competitive dynamics and market leverage
    - Emphasizes what events reveal about company direction, not just what happened
  - **Date**: 2026-01-13

#### System Prompt Enhancements
- **Updated `systemPrompt()`**: Added guidance for company research
  - **File**: `src/prompt.ts` (lines 1-25)
  - **Additions**:
    - Instructions to look for strategic implications and directional indicators
    - Focus on what events reveal about company power/position
    - Emphasis on competitive dynamics and market positioning
    - Examples: "If a company can require upfront payments despite regulatory pressure, that shows power"
    - Instructions to capture multiple stories/events, not just one angle
    - Priority on shocking/surprising/first-time developments
  - **Date**: 2026-01-13

### Historical Context Improvements
- **Updated prompts**: Replaced generic "2008" references with more recent, diverse examples (2010s-2020s)
  - **Rationale**: Avoid clichés, use more relevant historical context
  - **Date**: 2026-01-13

### Environment Configuration

#### Initial Setup
- **Created `.env.local`**: Environment variables for API keys
  - **Variables**:
    - `FIRECRAWL_KEY`: Firecrawl API key (now commented out for self-hosted)
    - `OPENAI_KEY`: OpenAI API key for o3-mini model
    - `FIRECRAWL_BASE_URL`: Base URL for self-hosted Firecrawl (added)
  - **Date**: 2026-01-13

### Code Quality

#### Error Handling
- **Improved error messages**: Better logging for different error types
  - **File**: `src/deep-research.ts` (lines 72-78)
  - **Features**:
    - Specific message for insufficient credits (402)
    - Clear message for max retries exceeded
    - Detailed retry attempt logging
  - **Date**: 2026-01-13

### Documentation

#### README Updates
- **No changes**: README already documented self-hosted Firecrawl support
  - **Note**: README mentions `FIRECRAWL_BASE_URL` for self-hosted instances
  - **Reference**: `README.md` (lines 99-100)

---

## Cost Analysis

### Before Optimizations
- **Firecrawl**: ~100 credits per run (breadth=4, depth=2, limit=5)
- **Cost**: ~$0.90 per run (at $9/1000 credits)
- **OpenAI**: ~$0.15-0.22 per run
- **Total**: ~$1.05-1.12 per run

### After Optimizations
- **Firecrawl**: ~60 credits per run (breadth=4, depth=2, limit=3)
- **Cost**: ~$0.54 per run (at $9/1000 credits)
- **OpenAI**: ~$0.15-0.22 per run
- **Total**: ~$0.69-0.76 per run
- **Savings**: ~35% reduction

### With Self-Hosted Firecrawl
- **Firecrawl**: $0 (self-hosted, no API costs)
- **OpenAI**: ~$0.15-0.22 per run
- **Total**: ~$0.15-0.22 per run
- **Savings**: ~85% reduction vs original, ~70% vs optimized

---

## Usage Notes

### Self-Hosted Firecrawl Setup

#### Using Docker Compose (Recommended)
```bash
# Start Firecrawl and deep-research services
docker compose up -d

# Check Firecrawl logs
docker logs firecrawl

# Test Firecrawl API
curl http://localhost:3002/health
```

#### Using Local Firecrawl (Non-Docker)
```bash
# Clone and run Firecrawl locally
git clone https://github.com/mendableai/firecrawl.git
cd firecrawl
docker compose up

# Update .env.local
FIRECRAWL_BASE_URL="http://localhost:3002"
```

### Configuration Options

#### Reduce Costs Further
- **Limit**: Reduce from 3 to 2 (saves ~33% on Firecrawl credits)
- **Breadth**: Reduce from 4 to 3 (saves ~25% on Firecrawl credits)
- **Depth**: Keep at 2 for quality (reducing to 1 saves ~67% but hurts quality)

#### Recommended Settings for Cost/Quality Balance
- **Breadth**: 3
- **Depth**: 2
- **Limit**: 2
- **Cost**: ~$0.35-0.45 per run (with cloud Firecrawl)
- **Cost**: ~$0.15-0.22 per run (with self-hosted Firecrawl)

---

## Future Improvements

### Potential Enhancements
- [ ] Add title-based filtering for Firecrawl searches (to reduce irrelevant scrapes)
- [ ] Implement caching for repeated queries
- [ ] Add support for local LLM (Ollama, LM Studio) to eliminate OpenAI costs
- [ ] Add proxy support for Firecrawl (if needed for high-volume scraping)
- [ ] Implement result deduplication to avoid processing same URLs multiple times
- [ ] Add cost tracking/monitoring dashboard

---

## Technical Details

### Files Modified
1. `src/deep-research.ts` - Retry logic, credit optimization, report generation
2. `src/prompt.ts` - System prompt and report style prompt
3. `docker-compose.yml` - Added Firecrawl service
4. `.env.local` - Updated for self-hosted Firecrawl

### Dependencies
- No new dependencies added
- Existing dependencies remain unchanged

### Breaking Changes
- None - all changes are backward compatible
- Self-hosted Firecrawl is optional (can still use cloud API)

---

## Credits

- Original project: [Open Deep Research](https://github.com/mendableai/deep-research)
- Firecrawl: [Mendable AI](https://firecrawl.dev)
- Self-hosting guide: [Firecrawl Docs](https://docs.firecrawl.dev/contributing/self-host)
