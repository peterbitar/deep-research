# Deep Research API - Holdings Integration Guide

## Overview

The Deep Research API needs to receive user holdings to personalize the feed. This guide explains how to integrate holdings data.

## Current Setup

- **Main Backend**: `https://wealthyrabbitios-production-03a4.up.railway.app`
  - Stores user holdings in PostgreSQL
  - Endpoint: `GET /api/holdings/{userId}`

- **Deep Research API**: `https://deep-research-production-0185.up.railway.app`
  - Provides cards, podcast, and chat
  - Currently returns global cards (not personalized)

- **iOS App**: Now sends `userId` as query parameter to `/api/report/cards`

---

## Recommended Approach: Deep Research API Fetches Holdings

### Option 1: Deep Research API Calls Main Backend (Recommended) ✅ IMPLEMENTED

**How it works:**
1. iOS app calls: `GET /api/report/cards?userId=xxx`
2. Deep Research API receives `userId` query parameter
3. Deep Research API calls main backend: `GET https://wealthyrabbitios-production-03a4.up.railway.app/api/holdings/{userId}`
4. Deep Research API uses holdings to personalize/filter cards
5. Returns personalized cards

**Implementation in Deep Research API:**

```typescript
// In src/api.ts - /api/report/cards endpoint
app.get('/api/report/cards', async (req: Request, res: Response) => {
  const userId = req.query.userId as string | undefined;
  let holdings: Array<{ symbol: string }> = [];
  
  // If userId provided, fetch holdings from main backend
  if (userId) {
    try {
      const mainBackendURL = process.env.MAIN_BACKEND_URL || 'https://wealthyrabbitios-production-03a4.up.railway.app';
      const fetchedHoldings = await fetchUserHoldings({
        userId,
        baseURL: mainBackendURL,
        healthCheck: false,
      });
      
      holdings = fetchedHoldings.map(h => ({ symbol: h.symbol }));
      console.log(`📊 Fetched ${holdings.length} holdings for user ${userId}`);
    } catch (error) {
      console.error('Failed to fetch holdings:', error);
      // Continue without holdings (return global cards)
    }
  }
  
  // Get cards from database
  const cards = await getCardsFromDatabase();
  
  // Personalize based on holdings
  const personalizedCards = personalizeCards(cards, holdings);
  
  res.json({
    success: true,
    cards: personalizedCards,
    metadata: {
      personalized: holdings.length > 0,
      userHoldingsCount: holdings.length,
      // ... rest of metadata
    }
  });
});

function personalizeCards(cards: CardType[], holdings: Array<{ symbol: string }>): CardType[] {
  if (!holdings || holdings.length === 0) {
    return cards; // Return all cards if no holdings
  }
  
  const holdingSymbols = new Set(
    holdings.map(h => h.symbol.toUpperCase().trim())
  );
  
  // Categorize cards: relevant (matching holdings) vs others
  const relevantCards: CardType[] = [];
  const otherCards: CardType[] = [];
  
  for (const card of cards) {
    const cardTicker = card.ticker?.toUpperCase().trim();
    const isRelevant = cardTicker && holdingSymbols.has(cardTicker);
    
    if (isRelevant) {
      relevantCards.push({ ...card, isRelevant: true });
    } else {
      otherCards.push(card);
    }
  }
  
  // Return: relevant cards first, then others (macro cards, non-matching holdings, etc.)
  return [...relevantCards, ...otherCards];
}
```

**Environment Variable Needed:**

In Deep Research API Railway service, add:
```
MAIN_BACKEND_URL=https://wealthyrabbitios-production-03a4.up.railway.app
```

**Status:** ✅ **IMPLEMENTED** - The personalization feature is already live!

---

### Option 2: iOS App Sends Holdings Directly

**How it works:**
1. iOS app fetches holdings from main backend first
2. iOS app sends holdings in request body or query params
3. Deep Research API uses holdings directly

**Implementation:**

**iOS App:**
```swift
func getPersonalizedFeed(userId: String, limit: Int = 50) async throws -> PersonalizedFeedResponse {
    // First, get holdings from main backend
    let holdings = try await getHoldings(userId: userId)
    let symbols = holdings.map { $0.symbol }
    
    // Send to Deep Research API
    var urlComponents = URLComponents(string: Config.cardsAPIURL)!
    urlComponents.queryItems = [
        URLQueryItem(name: "userId", value: userId),
        URLQueryItem(name: "holdings", value: symbols.joined(separator: ","))
    ]
    
    // ... make request
}
```

**Deep Research API:**
```javascript
app.get('/api/report/cards', async (req, res) => {
  const userId = req.query.userId;
  const holdingsParam = req.query.holdings; // "AAPL,NVDA,TSLA"
  
  const holdings = holdingsParam ? holdingsParam.split(',').map(s => ({ symbol: s.trim() })) : [];
  
  // Use holdings to personalize
  // ...
});
```

**Pros:**
- No need for Deep Research API to call main backend
- Faster (one less API call)

**Cons:**
- Requires iOS app changes
- Holdings sent in every request (less efficient)
- More complex iOS app logic

---

### Option 3: Shared Database (Advanced)

If both services are in the same Railway project, they can share the PostgreSQL database:

1. Deep Research API connects to same PostgreSQL
2. Deep Research API queries holdings directly from database
3. No need to call main backend

**Implementation:**
```javascript
// Deep Research API queries holdings directly
const holdings = await db.query(
  'SELECT symbol, name FROM holding WHERE user_id = $1',
  [userId]
);
```

**Pros:**
- Fastest (direct database access)
- No network calls between services

**Cons:**
- Requires shared database
- Both services need database access
- Tighter coupling
- Requires access to main backend's database schema

---

## Current Implementation: Option 1 (API-to-API Call) ✅

**Status:** ✅ **IMPLEMENTED AND TESTED**

**How it works:**
1. iOS app calls: `GET /api/report/cards?userId=xxx` (Deep Research API)
2. Deep Research API receives `userId` query parameter
3. Deep Research API calls main backend: `GET /api/holdings/xxx`
4. Deep Research API personalizes cards based on holdings
5. Returns personalized cards to iOS app

**Features:**
- ✅ Accepts `userId` query parameter
- ✅ Fetches holdings from main backend automatically
- ✅ Prioritizes cards matching user holdings (placed first)
- ✅ Gracefully falls back if holdings fetch fails
- ✅ Works for both database and filesystem data sources
- ✅ Returns metadata indicating personalization status

**Response Format:**
```json
{
  "success": true,
  "runId": "research-1768758513249",
  "publishedDate": "2026-01-19T05:40:09.726Z",
  "opening": "...",
  "cards": [
    {
      "title": "Apple AI & Service Growth",
      "content": "...",
      "ticker": "AAPL",
      "macro": null,
      "isRelevant": true,  // Only present when personalized
      "sources": [...],
      "publishedDate": "..."
    },
    // ... other cards
  ],
  "metadata": {
    "totalCards": 3,
    "totalSources": 58,
    "holdingsCards": 2,
    "macroCards": 1,
    "personalized": true,  // true if personalization applied
    "userHoldingsCount": 5  // Number of holdings used
  }
}
```

---

## Personalization Logic

Cards are personalized as follows:

1. **Matching Holdings Cards First**: Cards with `ticker` matching user holdings appear first
   - These cards have `isRelevant: true` flag
   - They maintain their original order relative to each other

2. **Other Cards Follow**: Macro cards and non-matching holdings cards appear after
   - Macro cards (e.g., "Central Bank Policy")
   - Holdings cards that don't match user holdings
   - Maintain original order within their category

**Example:**
```
User Holdings: [AAPL, NVDA]
Cards: [AAPL, NVDA, TSLA, Central Bank Policy, GOLD]

Personalized Order:
1. AAPL (isRelevant: true) - matches holdings
2. NVDA (isRelevant: true) - matches holdings
3. TSLA - non-matching holdings card
4. Central Bank Policy - macro card
5. GOLD - non-matching holdings card
```

---

## Environment Setup

### Deep Research API Railway Service

Add environment variable (optional - defaults to main backend URL):

```
MAIN_BACKEND_URL=https://wealthyrabbitios-production-03a4.up.railway.app
```

**Note:** If not set, the API defaults to the production main backend URL.

---

## Testing

### Test without userId (global feed):
```bash
curl https://deep-research-production-0185.up.railway.app/api/report/cards
```

**Expected:**
- Returns all cards
- `metadata.personalized = false`
- `metadata.userHoldingsCount = 0`

### Test with userId (personalized):
```bash
curl "https://deep-research-production-0185.up.railway.app/api/report/cards?userId=D96C07AD-DA20-457D-9CE5-D687D8BFB3DE"
```

**Expected:**
- Fetches holdings from main backend
- Returns personalized cards (matching holdings first)
- `metadata.personalized = true` (if holdings found)
- `metadata.userHoldingsCount > 0` (if holdings found)

### Verify holdings endpoint:
```bash
curl https://wealthyrabbitios-production-03a4.up.railway.app/api/holdings/D96C07AD-DA20-457D-9CE5-D687D8BFB3DE
```

**Expected:**
- Returns array of holdings: `[{ "symbol": "AAPL", ... }, ...]`
- Or error: `{"error": "Failed to fetch holdings"}`

### Test error handling:
If holdings fetch fails:
- API continues without personalization
- Returns all cards (not reordered)
- `metadata.personalized = false`
- Logs error but doesn't fail the request

---

## Implementation Details

### Files Modified:

1. **`src/api.ts`**:
   - Added `fetchUserHoldings` import
   - Added `personalizeCards` helper function
   - Updated `/api/report/cards` endpoint to accept `userId`
   - Fetches holdings when `userId` provided
   - Personalizes cards before returning

2. **`src/fetch-holdings.ts`**:
   - Existing utility function used to fetch holdings
   - Handles errors gracefully
   - Maps response to internal format

### Key Functions:

**`personalizeCards(cards, holdings)`**:
- Takes cards and user holdings
- Returns personalized card array
- Relevant cards (matching holdings) first
- Other cards follow

**`fetchUserHoldings(config)`**:
- Fetches holdings from main backend
- Returns array of `{ symbol, type, name }`
- Handles errors gracefully

---

## Error Handling

The implementation gracefully handles errors:

1. **Holdings fetch fails:**
   - Logs error
   - Continues without personalization
   - Returns all cards (not personalized)
   - `metadata.personalized = false`

2. **No userId provided:**
   - Skips holdings fetch
   - Returns all cards
   - `metadata.personalized = false`

3. **User has no holdings:**
   - Holdings array is empty
   - Returns all cards (not personalized)
   - `metadata.personalized = false`
   - `metadata.userHoldingsCount = 0`

4. **Main backend unavailable:**
   - Catches fetch error
   - Falls back to global cards
   - Request succeeds (doesn't fail)

---

## iOS App Integration

Your iOS app is already updated to send `userId`! ✅

**Current iOS implementation:**
```swift
// iOS app sends userId as query parameter
let url = URL(string: "https://deep-research-production-0185.up.railway.app/api/report/cards?userId=\(userId)")!
```

**Response handling:**
```swift
// Check if personalized
if response.metadata.personalized {
    // Cards are personalized
    // Cards with isRelevant: true appear first
}

// Filter cards if needed
let relevantCards = response.cards.filter { $0.isRelevant == true }
let otherCards = response.cards.filter { $0.isRelevant != true }
```

---

## Summary

**Current Flow:**
1. ✅ iOS app → `GET /api/report/cards?userId=xxx` (Deep Research API)
2. ✅ Deep Research API → `GET /api/holdings/xxx` (Main Backend)
3. ✅ Deep Research API → Personalizes cards based on holdings
4. ✅ Deep Research API → Returns personalized cards to iOS app

**Status:** ✅ **FULLY IMPLEMENTED AND TESTED**

**Next Steps:**
1. ✅ Add `MAIN_BACKEND_URL` to Railway environment variables (optional)
2. ✅ Test with real userIds that have holdings
3. ✅ Monitor logs for holdings fetch performance
4. ✅ Verify personalization works correctly in production

**Your iOS app is already updated to send `userId`!** ✅
