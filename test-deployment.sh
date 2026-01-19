#!/bin/bash
# Test script for deployed API

# Replace with your Railway URL
API_URL="${1:-https://your-app.railway.app}"

echo "🧪 Testing Deep Research API at: $API_URL"
echo ""

# Test 1: Health check (if you add one)
echo "1️⃣ Testing API availability..."
curl -s "$API_URL/api/podcast/latest" | jq -r '.success // "❌ API not responding"' && echo "✅ API is live!" || echo "❌ API not responding"

echo ""
echo "2️⃣ Testing Podcast Endpoint..."
curl -s "$API_URL/api/podcast/latest" | jq '{success, wordCount: .metadata.wordCount, estimatedMinutes: .metadata.estimatedMinutes}'

echo ""
echo "3️⃣ Testing Chat Endpoint..."
curl -s -X POST "$API_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "What happened with Apple this week?"}' | jq '{success, sessionId, messagePreview: (.message | .[0:100])}'

echo ""
echo "✅ Deployment test complete!"
