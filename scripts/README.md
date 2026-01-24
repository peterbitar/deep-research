# Test Scripts

Step-by-step test scripts for the batched deep research pipeline. Each script tests a specific phase and exports results to Excel.

## Test Scripts

### 1. `test-step1-gather.ts`
**Tests:** Gathering search results from multiple queries with deduplication

**What it does:**
- Generates SERP queries from a research question
- Searches all queries in parallel
- Deduplicates results by URL across queries
- Exports results to Excel with multiple sheets:
  - Summary: Overall statistics
  - Queries: All generated queries and their results
  - All Articles: Complete list of unique articles
  - Duplicates: Articles that appeared in multiple queries

**Run:**
```bash
npm run tsx scripts/test-step1-gather.ts
```

---

### 2. `test-step2-triage.ts`
**Tests:** Batch triage that selects relevant articles

**What it does:**
- Takes a list of articles (from step 1)
- Uses LLM to select relevant and important articles
- Filters out Tier 3 sources, outdated content, and irrelevant articles
- Exports results to Excel:
  - Summary: Selection statistics
  - Research Goals: All research goals used
  - Selected: Articles that passed triage
  - Rejected: Articles that were filtered out
  - All Articles: Complete list with status

**Run:**
```bash
npm run tsx scripts/test-step2-triage.ts
```

---

### 3. `test-step3-filter.ts`
**Tests:** Smart filtering that decides scrape vs metadata-only

**What it does:**
- Takes triaged articles (from step 2)
- Groups similar stories together
- Picks best source globally for each story
- Decides which articles need full scraping vs metadata-only
- Exports results to Excel:
  - Summary: Filtering statistics and cost savings
  - To Scrape: Articles that need full content
  - Metadata-Only: Articles where title/description is sufficient
  - All Articles: Complete list with scraping decision

**Run:**
```bash
npm run tsx scripts/test-step3-filter.ts
```

---

### 4. `test-step4-scrape.ts`
**Tests:** Scraping selected articles

**What it does:**
- Takes list of URLs to scrape (from step 3)
- Scrapes each article using Firecrawl
- Tracks success/failure, content length, and timing
- Exports results to Excel:
  - Summary: Scraping statistics
  - Scrape Results: Detailed results for each article

**Run:**
```bash
npm run tsx scripts/test-step4-scrape.ts
```

---

### 5. `test-step5-process.ts`
**Tests:** Processing and summarizing articles

**What it does:**
- Takes scraped articles (from step 4)
- Extracts learnings using LLM
- Generates follow-up questions
- Exports results to Excel:
  - Summary: Processing statistics
  - Learnings: All extracted learnings with types
  - Follow-up Questions: Generated questions for deeper research
  - Input Articles: Source articles used

**Run:**
```bash
npm run tsx scripts/test-step5-process.ts
```

---

### 6. `test-step6-report.ts`
**Tests:** Final report generation

**What it does:**
- Takes learnings from Step 5
- Generates final markdown report using Wealthy Rabbit style
- Saves report as `.md` file
- Exports summary to Excel:
  - Summary: Report statistics
  - Learnings Used: All learnings that went into the report
  - URLs Included: All source URLs
  - Cost Details: Report generation costs
  - Report Preview: First 5000 chars

**Run:**
```bash
npm run tsx scripts/test-step6-report.ts
```

---

### 7. `test-full-integration.ts`
**Tests:** Complete end-to-end pipeline

**What it does:**
- Runs the full batched deep research flow
- Tests all steps together: gather → triage → filter → scrape → process → report
- Generates final report
- Tracks progress throughout
- Exports comprehensive results to Excel:
  - Summary: Overall statistics
  - Progress Log: Step-by-step progress tracking
  - Learnings: All extracted learnings
  - Visited URLs: All URLs accessed
  - Report Preview: First 5000 chars of generated report

**Run:**
```bash
npm run tsx scripts/test-full-integration.ts
```

---

### 8. `test-all-steps.ts` ⭐ **PRE-TEST-FLIGHT VALIDATION**
**Tests:** All steps sequentially with validation

**What it does:**
- Runs all 7 steps sequentially (Step 1-7)
- **Validates each step before proceeding** - stops on first failure
- Provides detailed step-by-step progress and metrics
- Tracks costs and timing for each step
- Generates comprehensive test report
- **Perfect for pre-test-flight validation** - ensures all steps work before deployment
- Exports results to Excel:
  - Summary: Overall test results and pass/fail status
  - Steps: Detailed breakdown of each step (status, duration, cost, metrics)
  - Learnings: All extracted learnings
  - Visited URLs: All URLs accessed
  - Cost Details: Complete cost breakdown

**Run:**
```bash
npm run tsx scripts/test-all-steps.ts
```

**Exit codes:**
- `0` - All steps passed ✅
- `1` - One or more steps failed ❌

**Use case:** Run this before deploying to production to ensure all pipeline steps are working correctly.

---

## Output Format

All test scripts export results to Excel (`.xlsx`) files with:
- Multiple sheets for different data views
- Summary statistics
- Detailed data tables
- **Cost tracking** - Detailed cost breakdown by service and operation
- Fixed filenames that are overwritten on each run

### Cost Tracking

Each test script tracks API costs:
- **Firecrawl**: Search ($0.01/search) and Scrape ($0.075/scrape) costs
- **LLM (OpenAI/Fireworks)**: Token-based costs for all LLM calls
- **Cost breakdown**: By service (firecrawl, openai, fireworks) and by operation
- **Cost Details sheet**: Detailed breakdown of every API call with metadata

Cost estimates are based on typical pricing and may vary by your actual plan.

Files are saved in the `test-results/` folder with fixed names:
- `test-results/test-step1-gather.xlsx` (always contains latest Step 1 results)
- `test-results/test-step2-triage.xlsx` (always contains latest Step 2 results)
- `test-results/test-step3-filter.xlsx` (always contains latest Step 3 results)
- `test-results/test-step4-scrape.xlsx` (always contains latest Step 4 results)
- `test-results/test-step5-process.xlsx` (always contains latest Step 5 results)
- `test-results/test-full-integration.xlsx` (always contains latest integration test results)
- `test-results/test-integration-report.md` (always contains latest integration test report)
- `test-results/test-all-steps.xlsx` (always contains latest comprehensive test results)
- `test-results/test-all-steps-report.md` (always contains latest comprehensive test report)

## Running All Tests

You can run all tests sequentially:

```bash
npm run tsx scripts/test-step1-gather.ts
npm run tsx scripts/test-step2-triage.ts
npm run tsx scripts/test-step3-filter.ts
npm run tsx scripts/test-step4-scrape.ts
npm run tsx scripts/test-step5-process.ts
npm run tsx scripts/test-full-integration.ts
```

Or run just the integration test for a complete end-to-end test:

```bash
npm run tsx scripts/test-full-integration.ts
```

**For pre-test-flight validation**, run the comprehensive test:

```bash
npm run tsx scripts/test-all-steps.ts
```

This will validate all steps sequentially and exit with code 0 if all pass, or 1 if any fail.

## Production pipeline: holdings + macro → DB

### `run-holdings-macro-to-db.ts`

Runs the full **holdings + macro** research pipeline and writes **only to the database** (no local files).

**Flow:**

1. Fetch all users from the holdings API (`MAIN_BACKEND_URL` / `HOLDINGS_API_BASE_URL`).
2. Fetch holdings per user and **deduplicate by symbol**.
3. Research each holding (`deepResearch`) + macro scan (Central Bank Policy).
4. Generate the final report and save to DB: `research_runs`, `reports`, `report_cards`, `report_sources`.

**Requires:**

- `DATABASE_URL` (e.g. Railway Postgres).
- `MAIN_BACKEND_URL` or `HOLDINGS_API_BASE_URL` (defaults to production Railway; **must not be local**).
- `FIRECRAWL_KEY`, and `OPENAI_KEY` or `FIREWORKS_KEY`.

**Run:**

```bash
npm run holdings-macro-to-db
# or
npx tsx --env-file=.env.local scripts/run-holdings-macro-to-db.ts
```

The app serves the latest run via `/api/report/cards`.

---

## Requirements

- `.env.local` file with:
  - `FIRECRAWL_KEY` or `FIRECRAWL_BASE_URL`
  - `OPENAI_KEY` or other model configuration
- `xlsx` package (already in dependencies)
