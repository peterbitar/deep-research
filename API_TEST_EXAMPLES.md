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
