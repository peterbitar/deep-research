# Deployment Guide

This guide covers deploying the Deep Research API to production.

## Quick Deploy Options

### Option 1: Railway (Recommended - Easiest)

1. **Sign up**: Go to [railway.app](https://railway.app) and sign up with GitHub
2. **Create project**: Click "New Project" → "Deploy from GitHub repo"
3. **Select repo**: Choose your `deep-research` repository
4. **Configure environment variables**: Add all required env vars from `.env.local`:
   - `OPENAI_KEY` or `FIREWORKS_KEY` (or `CUSTOM_MODEL`)
   - `FIRECRAWL_KEY`
   - `FIRECRAWL_BASE_URL` (optional, defaults to Firecrawl cloud)
   - `PORT` (optional, defaults to 3051)
5. **Deploy**: Railway will auto-detect Node.js and deploy
6. **Get URL**: Railway provides a URL like `https://your-app.railway.app`

**Railway automatically:**
- Detects Node.js 22.x from `package.json`
- Runs `npm install`
- Runs `npm run start:api` (defined in `package.json`)
- Provides HTTPS URL

---

### Option 2: Render

1. **Sign up**: Go to [render.com](https://render.com) and sign up with GitHub
2. **New Web Service**: Click "New" → "Web Service"
3. **Connect repo**: Select your `deep-research` repository
4. **Configure**:
   - **Build Command**: `npm install`
   - **Start Command**: `npm run start:api`
   - **Environment**: Node 22
5. **Add Environment Variables**: Same as Railway above
6. **Deploy**: Click "Create Web Service"

---

### Option 3: Fly.io (Docker)

1. **Install Fly CLI**: `curl -L https://fly.io/install.sh | sh`
2. **Login**: `fly auth login`
3. **Create app**: `fly launch` (follow prompts)
4. **Set secrets**: `fly secrets set OPENAI_KEY=xxx FIRECRAWL_KEY=xxx`
5. **Deploy**: `fly deploy`

**Note**: You'll need to update `Dockerfile.production` or create a `fly.toml` config.

---

### Option 4: DigitalOcean App Platform

1. **Go to**: [cloud.digitalocean.com](https://cloud.digitalocean.com)
2. **Create App**: Connect GitHub repo
3. **Configure**:
   - Build Command: `npm install`
   - Run Command: `npm run start:api`
   - Environment: Node.js 22
4. **Add Environment Variables**: Same as above
5. **Deploy**

---

## Environment Variables Required

Make sure to set these in your deployment platform:

```bash
# AI Model (choose one)
OPENAI_KEY=your_openai_key
# OR
FIREWORKS_KEY=your_fireworks_key
# OR
CUSTOM_MODEL=your_custom_model

# Firecrawl (for web scraping)
FIRECRAWL_KEY=your_firecrawl_key
FIRECRAWL_BASE_URL=https://api.firecrawl.dev  # optional

# Server
PORT=3051  # optional, defaults to 3051

# Optional: Context size
CONTEXT_SIZE=128000
```

---

## API Endpoints

Once deployed, your API will be available at:

- `POST /api/research` - Run research
- `POST /api/generate-report` - Generate markdown report
- `POST /api/generate-report-json` - Generate JSON report
- `GET /api/report/latest` - Get latest report (JSON)
- `GET /api/report/cards` - Get latest report with detailed card metadata
- `POST /api/chat` - AI chat with knowledge base
- `GET /api/chat/session/:sessionId` - Get chat session history
- `GET /api/podcast/latest` - Get 4-minute podcast summary

---

## Testing Deployment

After deployment, test with:

```bash
# Health check (if you add one)
curl https://your-app.railway.app/health

# Test podcast endpoint
curl https://your-app.railway.app/api/podcast/latest

# Test chat
curl -X POST https://your-app.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What happened with Apple this week?"}'
```

---

## Storage Considerations

- Research results are stored in `research-results/` directory
- Chat sessions are in-memory (will reset on restart)
- For production, consider:
  - Using a database for chat sessions (Redis, PostgreSQL)
  - Using cloud storage for research results (S3, etc.)
  - Adding persistence for better scalability

---

## Recommended: Railway for Quick Deployment

Railway is the easiest option:
- ✅ Free tier available
- ✅ Automatic HTTPS
- ✅ GitHub integration
- ✅ Environment variable management
- ✅ Auto-deploys on push
- ✅ Easy rollback

Get started: https://railway.app/new
