#!/bin/bash
# Quick chat API test: price questions + news questions.
# Shows when web search and news brief (DB + fresh) were used.

API_URL="${1:-http://localhost:3051}"

echo "🧪 Chat API quick test (price + news)"
echo "📍 API URL: $API_URL"
echo ""

show_meta() {
  local resp="$1"
  local label="$2"
  local ws=$(echo "$resp" | jq -r '.metadata.webSearchUsed // false' 2>/dev/null)
  local cites=$(echo "$resp" | jq -r '.metadata.citationUrls | length // 0' 2>/dev/null)
  local fromDb=$(echo "$resp" | jq -r '.metadata.newsBriefFromDb // false' 2>/dev/null)
  local fresh=$(echo "$resp" | jq -r '.metadata.freshNewsFetched // []' 2>/dev/null)
  echo "  [$label] webSearchUsed=$ws | citationUrls=$cites | newsBriefFromDb=$fromDb | freshNewsFetched=$fresh"
}

# Test 1: Price question (expect: price tool, maybe no web search; no fresh news for "AAPL" if already in DB)
echo "━━━ 1. Price question: What's the price of AAPL? ━━━"
RESP1=$(curl -s -X POST "$API_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the current price of AAPL?"}')
echo "$RESP1" | jq -r '.message // .error // .' 2>/dev/null || echo "$RESP1"
show_meta "$RESP1" "Price"
SUCCESS1=$(echo "$RESP1" | jq -r '.success // false' 2>/dev/null)
echo ""

# Test 2: News question (expect: knowledge base + possibly web search; newsBriefFromDb or freshNewsFetched)
echo "━━━ 2. News question: Latest news on Apple ━━━"
RESP2=$(curl -s -X POST "$API_URL/api/chat" \
  -H "Content-Type: application/json" \
  -d '{"message": "What is the latest news on Apple? Tell me the story."}')
echo "$RESP2" | jq -r '.message // .error // .' 2>/dev/null || echo "$RESP2"
show_meta "$RESP2" "News"
SUCCESS2=$(echo "$RESP2" | jq -r '.success // false' 2>/dev/null)
echo ""

# Summary
if [ "$SUCCESS1" = "true" ] && [ "$SUCCESS2" = "true" ]; then
  echo "✅ Both chat tests returned success."
else
  echo "⚠️  One or more requests failed or API not reachable. Is the server running? (./start-api.sh)"
  exit 1
fi
