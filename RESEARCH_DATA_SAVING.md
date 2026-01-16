# Research Data Saving

The deep research pipeline now automatically saves all intermediate results at each step and iteration, giving you complete visibility and control over the research process.

## What Gets Saved

For each research run, a new directory is created in `research-results/` with a timestamp-based ID (e.g., `research-1768431282265/`).

### Per Iteration (Depth Level)

Each iteration creates its own subdirectory (`iteration-0/`, `iteration-1/`, etc.) containing:

1. **Step 1-2: Gather** (`step1-2-gather.xlsx`)
   - SERP queries generated
   - Research goals for each query
   - All unique articles gathered (after deduplication)
   - Article titles, descriptions, URLs

2. **Step 3: Triage** (`step3-triage.xlsx`)
   - Articles selected after batch triage
   - Total vs. selected counts

3. **Step 4: Filter** (`step4-filter.xlsx`)
   - Articles that need full scraping vs. metadata-only
   - Reasons for each decision
   - Story grouping and best source selection

4. **Step 5: Scrape** 
   - `step5-scrape.xlsx` - Summary of scraped articles (status, content length)
   - `step5-scraped-content.json` - Full markdown content (JSON due to Excel cell size limits)

5. **Step 6: Process** (`step6-process.xlsx`)
   - Learnings extracted from content
   - Follow-up questions generated
   - Visited URLs for this iteration

### Final Outputs

At the root of the research run directory:

- **`final-report.md`** - The complete markdown report
- **`final-report-summary.xlsx`** - Report statistics and preview
- **`comprehensive-summary.xlsx`** - Complete overview with:
  - All iterations summary
  - All learnings across all iterations
  - All visited URLs with iteration tracking
  - Cost summary (if available)
  - Individual sheets for each iteration with queries and follow-ups

## Iteration Tracking

Each iteration is clearly documented:
- **Iteration number** (0-based, 0 = initial)
- **Remaining depth** at start of iteration
- **Query used** (original or follow-up)
- **SERP queries generated**
- **Follow-up questions** that led to next iteration
- **Timestamp** of when iteration ran

## Usage

The data saving is automatically enabled when using `src/run.ts`. The data saver is optional in the `deepResearch` function, so existing code continues to work.

### Example Output Structure

```
research-results/
  research-1768431282265/
    iteration-0/
      step1-2-gather.xlsx
      step3-triage.xlsx
      step4-filter.xlsx
      step5-scrape.xlsx
      step5-scraped-content.json
      step6-process.xlsx
    iteration-1/
      step1-2-gather.xlsx
      step3-triage.xlsx
      step4-filter.xlsx
      step5-scrape.xlsx
      step5-scraped-content.json
      step6-process.xlsx
    final-report.md
    final-report-summary.xlsx
    comprehensive-summary.xlsx
```

## Benefits

1. **Full Transparency** - See exactly what was gathered, triaged, filtered, and scraped at each step
2. **Iteration Tracking** - Understand how the research evolved through depth iterations
3. **Debugging** - Identify issues at specific steps
4. **Reproducibility** - All data is saved for later analysis
5. **Cost Analysis** - Track costs per iteration and operation
6. **Query Evolution** - See how follow-up questions shaped subsequent iterations

## File Formats

- **Excel (.xlsx)** - Structured data, summaries, statistics
- **JSON** - Full content (markdown) that exceeds Excel cell limits
- **Markdown (.md)** - Final reports

All files are human-readable and can be opened directly in Excel, text editors, or JSON viewers.
