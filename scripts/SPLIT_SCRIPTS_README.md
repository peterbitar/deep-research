# Split Scripts for Holdings + Macro Research

The full pipeline has been split into 3 separate scripts to avoid timeouts and allow for better debugging:

## Scripts Overview

1. **`1-research-only.ts`** - Research phase (Steps 1-4)
   - Fetches users and holdings
   - Researches each holding
   - Runs macro scan
   - Saves learnings and URLs to DB

2. **`2-generate-report.ts`** - Report generation (Step 5)
   - Loads learnings from DB
   - Generates report with new breakdown (opening, cards one-by-one)
   - Saves initial report to DB (before rewriting)

3. **`3-rewrite-report.ts`** - Report rewrite (Step 7)
   - Loads report and learnings from DB
   - Rewrites each card (title + content separately)
   - Updates report in DB

## Usage

### Step 1: Research Only
```bash
npm run research-only
```

This will:
- Fetch all users from holdings API
- Fetch and deduplicate holdings
- Research each holding (NFLX, etc.)
- Run macro scan (Central Bank Policy)
- Save learnings to DB with a `run_id` like `research-1769181706794`

**Output:** Run ID that you can use for the next steps

### Step 2: Generate Report
```bash
npm run generate-report [runId]
```

If you don't provide a `runId`, it uses the latest research run.

This will:
- Load learnings from DB
- Generate report using the new breakdown:
  - Opening paragraph (~8s)
  - Each card separately:
    - Title + emoji (~5s)
    - Content (~6s)
- Save initial report to DB

**Output:** Report saved to DB (can be served via API)

### Step 3: Rewrite Report
```bash
npm run rewrite-report [runId]
```

If you don't provide a `runId`, it uses the latest report.

This will:
- Load report and learnings from DB
- Rewrite each card:
  - Title rewrite (~7s)
  - Content rewrite (~9s)
- Update report in DB

**Output:** Final rewritten report in DB

## Benefits

1. **No timeouts**: Each script runs independently, so if one times out, you don't lose all progress
2. **Better debugging**: You can test each phase separately
3. **Resume capability**: If something fails, you can retry from that step
4. **Faster iteration**: Test report generation without re-running research

## Example Workflow

```bash
# 1. Run research (may take 5-10 minutes)
npm run research-only
# Output: Run ID: research-1769181706794

# 2. Generate report (may take 1-3 minutes)
npm run generate-report research-1769181706794

# 3. Rewrite report (may take 2-5 minutes)
npm run rewrite-report research-1769181706794
```

## Database Schema

A new table `research_learnings` stores intermediate learnings:

```sql
CREATE TABLE research_learnings (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL,
    learning TEXT NOT NULL,
    learning_order INTEGER NOT NULL,
    source_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

URLs are stored in `report_sources` (existing table).

## Troubleshooting

- **"No learnings found"**: Make sure you ran `research-only` first
- **"No report found"**: Make sure you ran `generate-report` first
- **Timeout on research**: That's okay! The learnings are saved incrementally. Just re-run `generate-report` with the same run ID
- **Timeout on rewrite**: The initial report is still saved. You can retry `rewrite-report` with the same run ID
