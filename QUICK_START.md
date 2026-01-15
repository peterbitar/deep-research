# Quick Start Guide - Self-Hosted Firecrawl

## 🚀 Fast Setup (5 minutes)

### 1. Clone and Start Firecrawl

```bash
# In parent directory
cd ..
git clone https://github.com/mendableai/firecrawl.git
cd firecrawl

# Setup environment
cp apps/api/.env.example .env
# Edit .env: Set PORT=3002, HOST=0.0.0.0, USE_DB_AUTHENTICATION=false

# Start Firecrawl
docker compose up -d
```

### 2. Verify Firecrawl is Running

```bash
# Check health
curl http://localhost:3002/health

# Check logs
docker logs firecrawl
```

### 3. Update Deep Research Config

Your `.env.local` is already configured! It should have:
```bash
FIRECRAWL_BASE_URL="http://localhost:3002"
# FIRECRAWL_KEY="..." (commented out)
```

### 4. Run Research

```bash
cd deep-research
npm start
```

## ✅ That's It!

You're now running with **$0 Firecrawl costs** (only OpenAI costs remain).

## 📊 Cost Comparison

| Setup | Firecrawl Cost | OpenAI Cost | Total |
|-------|---------------|-------------|-------|
| **Before** | $0.54/run | $0.15-0.22/run | **$0.69-0.76/run** |
| **After** | **$0/run** | $0.15-0.22/run | **$0.15-0.22/run** |

**Savings: ~85% reduction** 🎉

## 🔧 Troubleshooting

### Firecrawl won't start?
```bash
# Check if port 3002 is in use
lsof -i :3002

# Check Firecrawl logs
docker logs firecrawl

# Restart
docker restart firecrawl
```

### Connection errors?
- Make sure Firecrawl is running: `docker ps | grep firecrawl`
- Test endpoint: `curl http://localhost:3002/health`
- Check `.env.local` has `FIRECRAWL_BASE_URL="http://localhost:3002"`

### Want to switch back to cloud API?
Uncomment `FIRECRAWL_KEY` and comment out `FIRECRAWL_BASE_URL` in `.env.local`

## 📚 More Details

- Full setup guide: `SETUP_SELF_HOSTED.md`
- All changes documented: `CHANGELOG.md`
