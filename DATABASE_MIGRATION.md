# Database Migration Guide - DBeaver & Manual Migration

This guide shows you how to migrate your latest report to the Railway PostgreSQL database using either:
1. **Automated script** (recommended)
2. **DBeaver manual import** (for manual control)

---

## Option 1: Automated Migration Script (Recommended)

### Step 1: Get Railway Database Connection String

1. Go to Railway → Your Project
2. Click on your **PostgreSQL** service
3. Go to **"Variables"** tab
4. Copy the `DATABASE_URL` value

It looks like:
```
postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway
```

### Step 2: Run Migration Script

```bash
# Set DATABASE_URL
export DATABASE_URL="postgresql://postgres:password@host:port/railway"

# Or add to .env.local file
echo "DATABASE_URL=postgresql://..." >> .env.local

# Run migration
npx tsx --env-file=.env.local scripts/migrate-report-to-db.ts
```

The script will:
- Find your latest report in `research-results/`
- Parse it into cards and sources
- Save everything to the database

---

## Option 2: Manual Migration with DBeaver

### Step 1: Connect DBeaver to Railway Database

1. **Open DBeaver**
2. **New Database Connection** → **PostgreSQL**
3. **Connection Settings**:
   - **Host**: Extract from `DATABASE_URL` (e.g., `containers-us-west-xxx.railway.app`)
   - **Port**: Usually `5432` (or extract from URL)
   - **Database**: Usually `railway` (or extract from URL)
   - **Username**: Usually `postgres` (extract from URL)
   - **Password**: Extract from `DATABASE_URL` (after `:` and before `@`)

**To extract from DATABASE_URL**:
```
postgresql://postgres:PASSWORD@HOST:PORT/DATABASE
              └─user─┘ └─pass┘  └─host─┘ └port┘ └─db──┘
```

### Step 2: Get Latest Report Data

Run this to see your latest report structure:
```bash
# Find latest report
ls -la research-results/ | tail -5

# View report path
cat research-results/research-{latest}/final-report.md | head -50
```

### Step 3: Insert Data into Tables

In DBeaver, run these SQL commands (replace values with your actual data):

#### 1. Insert Research Run

```sql
-- Get your latest run ID from research-results/ directory
-- Format: research-1768758513249

INSERT INTO research_runs (run_id, query, depth, breadth, status, created_at)
VALUES (
  'research-1768758513249',  -- Replace with your actual run ID
  'Migrated from filesystem - research-1768758513249',
  3,
  3,
  'completed',
  '2026-01-18 17:48:33'::timestamp  -- Extract from run ID timestamp
)
ON CONFLICT (run_id) DO NOTHING;
```

#### 2. Insert Report

```sql
-- Read your final-report.md and paste the full content
INSERT INTO reports (run_id, report_markdown, opening)
VALUES (
  'research-1768758513249',  -- Same run ID
  'PASTE_FULL_REPORT_MARKDOWN_HERE',  -- Full markdown content
  'PASTE_OPENING_PARAGRAPH_HERE'  -- First paragraph(s) before cards
)
ON CONFLICT (run_id) DO UPDATE SET
  report_markdown = EXCLUDED.report_markdown,
  opening = EXCLUDED.opening;
```

#### 3. Insert Report Cards

For each card in your report:

```sql
INSERT INTO report_cards (run_id, title, content, emoji, ticker, macro, card_order)
VALUES 
  ('research-1768758513249', 'Card Title 1', 'Card content...', '🍎', 'AAPL', NULL, 0),
  ('research-1768758513249', 'Card Title 2', 'Card content...', '💻', 'NVDA', NULL, 1),
  -- Add more cards...
  ('research-1768758513249', 'Macro Card', 'Content...', '🏦', NULL, 'Central Bank Policy', 5);
```

#### 4. Insert Sources

```sql
INSERT INTO report_sources (run_id, source_url, source_order)
VALUES 
  ('research-1768758513249', 'https://example.com/article1', 0),
  ('research-1768758513249', 'https://example.com/article2', 1),
  -- Add all sources from your report
  ('research-1768758513249', 'https://example.com/articleN', N);
```

---

## Option 3: Quick Helper Script (Interactive)

I can create a helper script that:
1. Reads your latest report
2. Shows you the SQL INSERT statements
3. You copy-paste into DBeaver

Would you like me to create that?

---

## Verification

After migration, verify in DBeaver:

```sql
-- Check research runs
SELECT run_id, query, created_at FROM research_runs ORDER BY created_at DESC;

-- Check report
SELECT run_id, LENGTH(report_markdown) as report_size, created_at FROM reports;

-- Check cards
SELECT run_id, title, ticker, macro FROM report_cards ORDER BY card_order;

-- Check sources
SELECT run_id, COUNT(*) as source_count FROM report_sources GROUP BY run_id;
```

Or test via API:
```bash
curl https://your-railway-url.railway.app/api/report/cards | jq
```

---

## Troubleshooting

### Connection Issues

- Make sure `DATABASE_URL` is correct
- Railway database might need whitelisting (Railway handles this automatically)
- Check Railway PostgreSQL service is "Active"

### Data Already Exists

If you get "duplicate key" errors:
- Delete existing data first: `DELETE FROM reports WHERE run_id = 'research-...';`
- Or use `ON CONFLICT DO UPDATE` (shown in examples above)

### Need to Update Existing Report

```sql
-- Update report content
UPDATE reports 
SET report_markdown = 'NEW_CONTENT', 
    updated_at = CURRENT_TIMESTAMP
WHERE run_id = 'research-1768758513249';

-- Update cards (delete and re-insert)
DELETE FROM report_cards WHERE run_id = 'research-1768758513249';
-- Then re-insert as shown above
```

---

## Quick Reference: Table Structure

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `research_runs` | Metadata about each research run | `run_id`, `query`, `created_at` |
| `reports` | Full markdown report | `run_id`, `report_markdown`, `opening` |
| `report_cards` | Individual cards | `run_id`, `title`, `content`, `ticker`, `macro`, `card_order` |
| `report_sources` | Source URLs | `run_id`, `source_url`, `source_order` |
| `chat_sessions` | Chat session metadata | `session_id`, `created_at` |
| `chat_messages` | Chat messages | `session_id`, `role`, `content`, `message_order` |
