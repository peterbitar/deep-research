# PostgreSQL Database Setup Guide

This guide explains how to set up PostgreSQL for persistent storage of reports and chat sessions.

## Quick Setup (Railway)

### Step 1: Add PostgreSQL Service

1. In Railway dashboard, go to your project
2. Click **"+ New"** → **"Database"** → **"Add PostgreSQL"**
3. Railway will create a PostgreSQL service automatically

### Step 2: Connect to API Service

Railway automatically creates a `DATABASE_URL` environment variable. The API will:
- Automatically detect `DATABASE_URL`
- Connect to the database on startup
- Create schema tables automatically

**No manual configuration needed!** Railway handles everything.

---

## Manual Setup (Local Development)

### Step 1: Install PostgreSQL

```bash
# macOS
brew install postgresql
brew services start postgresql

# Ubuntu/Debian
sudo apt-get install postgresql postgresql-contrib
sudo systemctl start postgresql
```

### Step 2: Create Database

```bash
# Create database
createdb deep_research

# Or using psql
psql postgres
CREATE DATABASE deep_research;
\q
```

### Step 3: Set Environment Variable

Add to `.env.local`:
```bash
DATABASE_URL=postgresql://username:password@localhost:5432/deep_research
```

### Step 4: Run Application

The API will automatically:
- Connect to database
- Create tables if they don't exist
- Start using database for storage

---

## Database Schema

The following tables are created automatically:

- **research_runs** - Research job metadata
- **reports** - Final markdown reports
- **report_cards** - Individual report cards
- **report_sources** - Source URLs
- **chat_sessions** - Chat session metadata
- **chat_messages** - Chat message history

---

## How It Works

### Hybrid Storage (Database + Filesystem)

The API uses a **hybrid approach**:

1. **Try database first** - If `DATABASE_URL` is set, use database
2. **Fallback to filesystem** - If database unavailable, use filesystem

This means:
- ✅ Works immediately (even without database)
- ✅ Auto-upgrades to database when available
- ✅ No data loss during migration

### What Gets Stored in Database

- ✅ **Research reports** (markdown)
- ✅ **Report cards** (title, content, ticker, macro)
- ✅ **Report sources** (URLs)
- ✅ **Chat sessions** (all messages)
- ❌ **Intermediate files** (Excel, JSON) - Still filesystem

---

## Verification

After setup, check logs:

```
✅ Database connection successful
✅ Database schema initialized
```

Your iOS app will automatically fetch from database!

---

## Troubleshooting

### Database Not Connecting

Check:
1. `DATABASE_URL` is set correctly
2. Database service is running (Railway shows "Active")
3. Check Railway logs for connection errors

### Schema Not Created

The schema is created automatically on first run. If issues:
- Check logs for SQL errors
- Manually run `src/db/schema.sql` if needed

### Still Using Filesystem

If database is not used:
- Check `DATABASE_URL` is set
- Check logs for connection errors
- API falls back to filesystem automatically (this is OK!)

---

## Benefits

✅ **Persistent storage** - Data survives restarts  
✅ **Scalable** - Can query efficiently  
✅ **iOS app ready** - All data accessible via API  
✅ **Chat history** - Persists across deployments  
