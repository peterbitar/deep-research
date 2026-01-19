# Data Storage Guide

## Current Storage Location

### Research Data
- **Location**: `research-results/` directory on the server filesystem
- **Structure**: 
  ```
  research-results/
    research-{timestamp}/
      final-report.md          ← Main report (iOS app fetches this)
      final-report-summary.xlsx
      comprehensive-summary.xlsx
      iteration-0/
        step1-2-gather.xlsx
        step3-triage.xlsx
        step4-filter.xlsx
        step5-scrape.xlsx
        step5-scraped-content.json
        step6-process.xlsx
  ```

### Chat Sessions
- **Location**: In-memory (RAM) - **NOT persistent**
- **Storage**: `Map<string, ChatSession>` in `src/api.ts`
- **Problem**: Lost on server restart/redeploy

---

## ⚠️ Critical Issue: Railway Ephemeral Filesystem

**Problem**: Railway's filesystem is **ephemeral** - data is lost when:
- Server restarts
- Deployment redeploys
- Container is recreated

**Impact**:
- Research reports will be lost
- Chat sessions will be lost
- iOS app won't be able to fetch old data

---

## Solutions for Persistent Storage

### Option 1: Railway Volume (Recommended for Quick Fix)

Railway offers persistent volumes:

1. **Add Volume**:
   - Railway → Your Service → Settings → Volumes
   - Click "Add Volume"
   - Mount path: `/app/research-results`

2. **Update Code** (if needed):
   - The code already uses `research-results/` directory
   - Just mount the volume to that path

**Pros**: Easy, works immediately
**Cons**: Only works on Railway, not portable

---

### Option 2: Database (PostgreSQL/MySQL)

Store research data in a database:

**Tables needed**:
- `research_runs` - Store research metadata
- `reports` - Store final reports (markdown)
- `chat_sessions` - Store chat history
- `cards` - Store individual report cards

**Pros**: 
- Persistent across deployments
- Queryable
- Scalable

**Cons**: 
- Requires database setup
- Need to migrate code

---

### Option 3: Cloud Storage (S3, Cloudflare R2)

Store reports in object storage:

**Structure**:
```
s3://your-bucket/
  research-{timestamp}/
    final-report.md
    metadata.json
```

**Pros**:
- Highly scalable
- Persistent
- Can serve directly to iOS app

**Cons**:
- Requires S3 setup
- Need to update code to read/write to S3

---

### Option 4: Hybrid Approach (Recommended)

**For Production**:
1. **Research Reports** → Database or S3
2. **Chat Sessions** → Redis or Database
3. **Intermediate Data** → Can stay ephemeral (regenerated)

---

## Current API Endpoints (How iOS App Fetches Data)

### 1. Report Cards (GET /api/report/cards)
- **Source**: `research-results/research-{latest}/final-report.md`
- **Returns**: JSON with cards, ticker, macro, sources, date
- **Status**: ⚠️ Will lose data on Railway restart

### 2. Podcast (GET /api/podcast/latest)
- **Source**: `research-results/research-{latest}/final-report.md`
- **Returns**: 4-minute podcast summary
- **Status**: ⚠️ Will lose data on Railway restart

### 3. Chat (POST /api/chat)
- **Source**: In-memory Map
- **Returns**: Chat responses
- **Status**: ⚠️ Will lose sessions on restart

### 4. Latest Report (GET /api/report/latest)
- **Source**: `research-results/research-{latest}/final-report.md`
- **Returns**: Full markdown report
- **Status**: ⚠️ Will lose data on Railway restart

---

## Quick Fix: Add Railway Volume

**Steps**:
1. Railway → Your Service → Settings → Volumes
2. Click "Add Volume"
3. Name: `research-data`
4. Mount Path: `/app/research-results`
5. Save

This will persist your research data across deployments.

---

## Long-term Solution: Database Migration

For production, consider migrating to a database:

1. **Add PostgreSQL** (Railway has one-click setup)
2. **Create tables** for reports, cards, chat sessions
3. **Update API** to read/write from database
4. **Keep S3** for large files (scraped content, Excel files)

---

## Testing Current Setup

Your iOS app can fetch data from:
```
https://deep-research-production-0185.up.railway.app/api/report/cards
```

But remember: **Data is ephemeral** until you add persistent storage!
