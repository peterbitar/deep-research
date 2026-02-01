# Production Setup Guide

This guide shows you how to run the research pipeline automatically in production on Railway.

## Overview

Your pipeline has 3 steps:
1. **Research Only** - Fetches holdings, researches each, runs macro scan, saves to DB
2. **Generate Report** - Creates report from saved learnings
3. **Rewrite Report** - Refines and improves the report

## Important: Database Connection Strings

Railway provides two types of database connection strings:

1. **Internal** (`postgres-xxx.railway.internal`) - Only works inside Railway's network
2. **Public** (`containers-us-west-xxx.railway.app`) - Works from anywhere

**When running via Railway CLI from your local machine**, you need the **public** connection string.

### How to Get Public Connection String

1. Go to Railway Dashboard → Your Postgres service
2. Click **"Connect"** tab
3. Under **"Public Network"**, copy the connection string
4. It should look like: `postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway`

### For Railway Cron (Recommended)

Railway Cron automatically uses the **internal** connection string, so no changes needed!

---

## Option 1: Railway Cron (Recommended) ⭐

Railway Cron allows you to run scripts on a schedule automatically.

### Step 1: Add a Cron Service

1. Go to your Railway project dashboard
2. Click **"+ New"** → **"Cron Job"**
3. Configure:
   - **Name**: `research-pipeline`
   - **Schedule**: `0 2 * * *` (runs daily at 2 AM UTC)
     - Or customize: `0 */6 * * *` (every 6 hours)
   - **Command**: `npm run full-pipeline`
   - **Service**: Select your main service (the one with your API)

### Step 2: Set Environment Variables

Make sure your Cron service has access to all environment variables:
- `DATABASE_URL` (Railway Postgres connection string - will use internal automatically)
- `OPENAI_KEY` or `FIREWORKS_KEY`
- `FIRECRAWL_KEY`
- `MAIN_BACKEND_URL` or `HOLDINGS_API_BASE_URL`
- Any other env vars your scripts need

**Note**: Railway Cron services inherit env vars from the parent service, but you can override them if needed.

### Step 3: Test the Cron Job

1. In Railway dashboard, go to your Cron service
2. Click **"Run Now"** to test
3. Check logs to verify it runs successfully

### Common Cron Schedules

```bash
# Daily at 2 AM UTC
0 2 * * *

# Every 6 hours
0 */6 * * *

# Every 12 hours (noon and midnight UTC)
0 0,12 * * *

# Every Monday at 9 AM UTC
0 9 * * 1

# Twice daily (2 AM and 2 PM UTC)
0 2,14 * * *
```

---

## News Brief as a Cron Job

The news-brief pipeline (OpenAI web search, 3 passes per holding, conversational cards) can run on its own schedule, separate from the full research pipeline. It uses the same **Custom Start Command** (`npm start`) as the other pipeline; the env var `RAILWAY_CRON` decides which job runs.

### Add a News Brief Cron

1. In your Railway project, add a **Cron Schedule** to a service (or create a dedicated cron service).
2. Keep **Custom Start Command** as `npm start` (from railway.json).
3. Set **Cron Schedule** (e.g. Weekly on Monday `0 0 * * 1`, or Daily at 6 AM `0 6 * * *`).
4. In that service’s **Variables**, set:
   - **`RAILWAY_CRON`** = **`news-brief`**  
   So when the cron runs, `npm start` runs the news-brief pipeline instead of the API.

### Env vars for news-brief

- `DATABASE_URL` — Postgres (Railway internal is fine for cron)
- `OPENAI_KEY` or `OPENAI_API_KEY` — required for news-brief
- `MAIN_BACKEND_URL` or `HOLDINGS_API_BASE_URL` — used to fetch user holdings (if you don’t set `RESEARCH_SYMBOLS`)

Optional:

- `RESEARCH_SYMBOLS=BTC,NVDA,VOO` — run for these symbols only (testing); if unset, holdings come from the users API
- `NEWS_BRIEF_MODE=non-reasoning` | `agentic` | `deep-research` (default: `non-reasoning`)
- `NEWS_BRIEF_MACRO=true` (default) — include macro pass

### Run news-brief manually (Railway CLI)

```bash
railway run --service <your-service> npm run news-brief
# With a fixed symbol list:
railway run --service <your-service> RESEARCH_SYMBOLS=BTC,NVDA npm run news-brief
```

---

## Option 2: Railway CLI (Manual Trigger)

For manual runs or testing, use Railway CLI:

### Install Railway CLI

```bash
npm i -g @railway/cli
railway login
```

### Get Public Database Connection String

**Important**: Railway CLI runs from your local machine, so you need the **public** connection string.

1. Railway Dashboard → Postgres service → **"Connect"** tab
2. Under **"Public Network"**, copy the connection string
3. Set it in your local `.env.local`:
   ```bash
   DATABASE_URL=postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway
   ```

### Run Scripts

```bash
# From your project directory
cd /Users/peter/projects/Github/deep-research

# Link to Railway project (first time only)
railway link

# Run full pipeline
railway run --service deep-research npm run full-pipeline

# Or run individual scripts
railway run --service deep-research npm run research-only
railway run --service deep-research npm run generate-report
railway run --service deep-research npm run rewrite-report
railway run --service deep-research npm run news-brief
```

**Note**: Railway CLI will pull env vars from Railway, but if `DATABASE_URL` uses the internal hostname, you'll need to override it with the public one in your `.env.local`.

---

## Option 3: Run Locally (Testing)

For local testing, you can run the scripts directly:

### Setup

1. Get **public** database connection string from Railway dashboard
2. Add to `.env.local`:
   ```bash
   DATABASE_URL=postgresql://postgres:password@containers-us-west-xxx.railway.app:5432/railway
   OPENAI_KEY=your_key
   FIRECRAWL_KEY=your_key
   MAIN_BACKEND_URL=https://wealthyrabbitios-production-03a4.up.railway.app
   ```

3. Run:
   ```bash
   npm run full-pipeline
   ```

**Note**: This runs on your local machine but saves to Railway's database.

---

## Option 4: Separate Cron Services (Advanced)

If you want more control, create separate cron jobs for each step:

### Cron 1: Research Only
- **Schedule**: `0 1 * * *` (1 AM daily)
- **Command**: `npm run research-only`

### Cron 2: Generate Report
- **Schedule**: `0 2 * * *` (2 AM daily, after research)
- **Command**: `npm run generate-report`

### Cron 3: Rewrite Report
- **Schedule**: `0 3 * * *` (3 AM daily, after generate)
- **Command**: `npm run rewrite-report`

**Note**: This approach requires careful timing to ensure each step completes before the next starts.

---

## Environment Variables Checklist

Make sure these are set in Railway:

```bash
# Database (Railway will set this automatically, but check it's correct)
DATABASE_URL=postgresql://...  # Use public connection string for local runs

# AI Model (choose one)
OPENAI_KEY=your_key
# OR
FIREWORKS_KEY=your_key

# Firecrawl
FIRECRAWL_KEY=your_key
FIRECRAWL_BASE_URL=https://api.firecrawl.dev  # optional

# Holdings API
MAIN_BACKEND_URL=https://wealthyrabbitios-production-03a4.up.railway.app
# OR
HOLDINGS_API_BASE_URL=https://wealthyrabbitios-production-03a4.up.railway.app

# Optional
FIRECRAWL_CONCURRENCY=2  # Firecrawl calls per holding (default: 2)
HOLDINGS_CONCURRENCY=8  # Holdings to research in parallel (default: 8 for Firecrawl Standard)
# Note: With Firecrawl Standard (50 concurrent), you can use HOLDINGS_CONCURRENCY=8-10
# This means 8 holdings * 2 FIRECRAWL_CONCURRENCY = 16 concurrent Firecrawl calls (well under 50)
LOG_LEVEL=info  # Log level: error, warn, info, debug (default: info)
CONTEXT_SIZE=128000
```

---

## Troubleshooting

### Error: `ENOTFOUND postgres-xxx.railway.internal`

**Problem**: You're using Railway's internal hostname from your local machine.

**Solution**: 
- For Railway Cron: This is fine, internal hostname works inside Railway
- For Railway CLI or local runs: Use the **public** connection string from Railway dashboard

### Script Fails in Cron

1. **Check logs** in Railway dashboard
2. **Verify env vars** are set correctly
3. **Test manually** with `railway run --service deep-research npm run full-pipeline`
4. **Check database connection** - ensure `DATABASE_URL` is correct

### Script Times Out

- Railway Cron jobs have generous time limits (much longer than HTTP)
- If it still times out, split into separate cron jobs (Option 4)

### Script Runs But No Data

- Check that `DATABASE_URL` is set
- Verify holdings API is accessible
- Check API keys are valid

---

## Recommended Setup

**For Production:**

1. ✅ Use **Railway Cron** (Option 1) with `full-pipeline` script
2. ✅ Schedule: Daily at 2 AM UTC (or your preferred time)
3. ✅ Monitor logs after first run
4. ✅ Set up alerts if needed (Railway can email on failures)

**For Testing:**

1. ✅ Get **public** database connection string from Railway
2. ✅ Add to `.env.local`
3. ✅ Use **Railway CLI** (Option 2) or run locally (Option 3)
4. ✅ Test each script individually before running full pipeline

---

## Next Steps

1. **For Production**: Set up Railway Cron with `npm run full-pipeline`
2. **For Testing**: Get public DB connection string, add to `.env.local`, test with Railway CLI
3. Monitor the first few runs
4. Adjust schedule as needed
5. Set up monitoring/alerts if desired

Your iOS app will automatically get fresh reports via `GET /api/report/cards` once the pipeline runs! 🎉
