# API Test Examples

Replace `YOUR_RAILWAY_URL` with your actual Railway URL (e.g., `https://deep-research-production.up.railway.app`)

## Quick Tests

### 1. Test Podcast Endpoint
```bash
curl https://YOUR_RAILWAY_URL/api/podcast/latest | jq
```

### 2. Test Report Cards
```bash
curl https://YOUR_RAILWAY_URL/api/report/cards | jq
```

### 3. Test Chat
```bash
curl -X POST https://YOUR_RAILWAY_URL/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What happened with Apple this week?"}' | jq
```

### 4. Test Latest Report
```bash
curl https://YOUR_RAILWAY_URL/api/report/latest | jq
```

### 5. Test Holding Checkup (investor checkup for a holding)
```bash
# Stock (default if type omitted)
curl -X POST https://YOUR_RAILWAY_URL/api/holding-checkup \
  -H "Content-Type: application/json" \
  -d '{"symbol": "AAPL", "name": "Apple"}' | jq

# Crypto (type or symbol like BTC/ETH)
curl -X POST https://YOUR_RAILWAY_URL/api/holding-checkup \
  -H "Content-Type: application/json" \
  -d '{"symbol": "BTC", "type": "crypto"}' | jq

# ETF
curl -X POST https://YOUR_RAILWAY_URL/api/holding-checkup \
  -H "Content-Type: application/json" \
  -d '{"symbol": "SPY", "type": "etf", "name": "SPDR S&P 500"}' | jq
```

## Full Test with Script

```bash
# Make sure script is executable
chmod +x test-api.sh

# Run tests
./test-api.sh https://YOUR_RAILWAY_URL
```

## Expected Responses

### Podcast Endpoint (GET /api/podcast/latest)
```json
{
  "success": true,
  "runId": "research-...",
  "publishedDate": "...",
  "content": "Welcome back to the show...",
  "metadata": {
    "wordCount": 543,
    "estimatedMinutes": 4,
    "estimatedSeconds": 218
  }
}
```

### Chat Endpoint (POST /api/chat)
```json
{
  "success": true,
  "sessionId": "uuid-here",
  "message": "Response from chat...",
  "metadata": {
    "sessionAge": 1000,
    "messageCount": 2
  }
}
```

### Holding Checkup (POST /api/holding-checkup)
Request body: `{ "symbol": "AAPL", "type": "stock" }` (type optional; inferred from symbol if omitted).  
Response:
```json
{
  "success": true,
  "checkup": "Here's a quick health check for Apple...",
  "assetType": "stock",
  "symbol": "AAPL"
}
```

### Report Cards (GET /api/report/cards)
```json
{
  "success": true,
  "runId": "research-...",
  "publishedDate": "...",
  "opening": "...",
  "cards": [
    {
      "title": "...",
      "content": "...",
      "ticker": "AAPL",
      "macro": null,
      "sources": [...],
      "publishedDate": "..."
    }
  ]
}
```
