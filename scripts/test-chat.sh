#!/bin/bash
# Quick chat API test: price questions + news questions

API_URL="${1:-http://localhost:3051}"

echo "🧪 Chat API quick test (price + news)"
echo "📍 API URL: $API_URL"
echo ""

# Test 1: Price question (should use getStockPrice tool)
echo "━━━ 1. Price question: What's the price of AAPL? ━━━"
RESP1=$(curl -s -X POST "$API_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the current price of AAPL?"}')
echo "$RESP1" | jq -r '.message // .error // .' 2>/dev/null || echo "$RESP1"
SUCCESS1=$(echo "$RESP1" | jq -r '.success // false' 2>/dev/null)
echo "Success: $SUCCESS1"
echo ""

# Test 2: News question (should use knowledge base / web search, narrative first)
echo "━━━ 2. News question: Latest news on Apple ━━━"
RESP2=$(curl -s -X POST "$API_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the latest news on Apple? Tell me the story."}')
echo "$RESP2" | jq -r '.message // .error // .' 2>/dev/null || echo "$RESP2"
SUCCESS2=$(echo "$RESP2" | jq -r '.success // false' 2>/dev/null)
echo "Success: $SUCCESS2"
echo ""

# Summary
if [ "$SUCCESS1" = "true" ] && [ "$SUCCESS2" = "true" ]; then
  echo "✅ Both chat tests returned success."
else
  echo "⚠️  One or more requests failed or API not reachable. Is the server running? (./start-api.sh)"
  exit 1
fi
