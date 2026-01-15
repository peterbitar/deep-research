# Self-Hosted Firecrawl Setup Guide

This guide will help you set up self-hosted Firecrawl to eliminate Firecrawl API costs.

## Prerequisites

- Docker and Docker Compose installed
- Node.js (for local development, if not using Docker)

## Quick Start (Recommended Method)

### Step 1: Clone and Start Firecrawl

```bash
# Clone Firecrawl repository (in parent directory or separate location)
cd ..
git clone https://github.com/mendableai/firecrawl.git
cd firecrawl

# Copy environment example
cp apps/api/.env.example .env

# Edit .env and set minimum required variables:
# PORT=3002
# HOST=0.0.0.0
# USE_DB_AUTHENTICATION=false

# Start Firecrawl
docker compose up -d

# Check if Firecrawl is running
docker logs firecrawl

# You should see Firecrawl running on port 3002
```

### Step 2: Update .env.local

```bash
# Go back to deep-research directory
cd ../deep-research

# Update .env.local to use local Firecrawl
# FIRECRAWL_BASE_URL="http://localhost:3002"
# Comment out or remove FIRECRAWL_KEY
```

### Step 3: Verify Firecrawl is Working

```bash
# Test Firecrawl health endpoint
curl http://localhost:3002/health

# Should return a health check response
```

### Step 4: Run Deep Research

```bash
# Run directly (if Node.js is installed locally)
npm start

# Or using Docker
docker compose up -d deep-research
docker exec -it deep-research npm start
```

## Local Setup (Without Docker)

### Step 1: Clone and Run Firecrawl

```bash
# Clone Firecrawl repository
git clone https://github.com/mendableai/firecrawl.git
cd firecrawl

# Copy environment example
cp apps/api/.env.example .env

# Edit .env and set:
# PORT=3002
# HOST=0.0.0.0
# USE_DB_AUTHENTICATION=false

# Start Firecrawl
docker compose up
```

### Step 2: Update .env.local

```bash
# In your deep-research project directory
# Update .env.local:
FIRECRAWL_BASE_URL="http://localhost:3002"
# Comment out or remove FIRECRAWL_KEY
```

### Step 3: Run Deep Research

```bash
npm start
```

## Troubleshooting

### Firecrawl Not Starting

```bash
# Check Firecrawl logs
docker logs firecrawl

# Restart Firecrawl
docker restart firecrawl

# Check if port 3002 is already in use
lsof -i :3002
```

### Connection Errors

If you see connection errors:

1. **Docker networking**: Make sure `deep-research` container can reach `firecrawl` container
   - Use `http://firecrawl:3002` in `.env.local` when running in Docker
   - Use `http://localhost:3002` when running locally

2. **Check Firecrawl is running**:
   ```bash
   docker ps | grep firecrawl
   ```

3. **Test connectivity**:
   ```bash
   # From deep-research container
   docker exec deep-research curl http://firecrawl:3002/health
   
   # From local machine
   curl http://localhost:3002/health
   ```

### Rate Limiting

Self-hosted Firecrawl doesn't have the same rate limits as the cloud API, but:
- You may still hit website rate limits
- Consider adding delays between requests
- Use proxies if scraping aggressively

## Cost Comparison

### Before (Cloud Firecrawl)
- Firecrawl: ~$0.54 per run
- OpenAI: ~$0.15-0.22 per run
- **Total: ~$0.69-0.76 per run**

### After (Self-Hosted Firecrawl)
- Firecrawl: $0 (self-hosted)
- OpenAI: ~$0.15-0.22 per run
- **Total: ~$0.15-0.22 per run**
- **Savings: ~85% reduction**

## Advanced Configuration

### Using Redis (Optional)

If you need queue management, uncomment Redis in `docker-compose.yml`:

```yaml
redis:
  image: redis:7-alpine
  container_name: firecrawl-redis
  ports:
    - "6379:6379"
```

Then update Firecrawl environment variables to use Redis.

### Proxy Configuration

If you need proxies for high-volume scraping, configure them in Firecrawl's environment variables (see Firecrawl documentation).

## Switching Back to Cloud API

If you want to switch back to cloud Firecrawl:

1. Update `.env.local`:
   ```bash
   FIRECRAWL_KEY="your_api_key_here"
   # FIRECRAWL_BASE_URL="http://firecrawl:3002"
   ```

2. Stop self-hosted Firecrawl:
   ```bash
   docker compose stop firecrawl
   ```

## Resources

- [Firecrawl Self-Hosting Guide](https://docs.firecrawl.dev/contributing/self-host)
- [Firecrawl GitHub](https://github.com/mendableai/firecrawl)
- [Docker Documentation](https://docs.docker.com/)
