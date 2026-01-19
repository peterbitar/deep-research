# Deep Research API Documentation

**Base URL**: `https://deep-research-production-0185.up.railway.app`

All endpoints return JSON. All endpoints support CORS.

---

## 📊 Report Endpoints

### 1. Get Report Cards (Recommended for iOS)

**Endpoint**: `GET /api/report/cards`

**Description**: Returns the latest research report with detailed card metadata, perfect for displaying in your iOS app.

**Response**:
```json
{
  "success": true,
  "runId": "research-1768758513249",
  "publishedDate": "2026-01-18T17:48:33.249Z",
  "opening": "Welcome to this week's financial intelligence...",
  "cards": [
    {
      "title": "Apple AI & Service Growth",
      "content": "So here's something intriguing: Apple has been...",
      "emoji": "🍎",
      "ticker": "AAPL",
      "macro": null,
      "sources": [
        "https://example.com/article1",
        "https://example.com/article2"
      ],
      "publishedDate": "2026-01-18T17:48:33.249Z"
    },
    {
      "title": "Fed & ECB Policy Outlook",
      "content": "The macroeconomic backdrop has also served...",
      "emoji": "🏦",
      "ticker": null,
      "macro": "Central Bank Policy",
      "sources": [...],
      "publishedDate": "2026-01-18T17:48:33.249Z"
    }
  ],
  "metadata": {
    "totalCards": 3,
    "totalSources": 58,
    "holdingsCards": 2,
    "macroCards": 1
  }
}
```

**Card Fields**:
- `title`: Card title (string)
- `content`: Full card content (string)
- `emoji`: Optional emoji icon (string | null)
- `ticker`: Stock/crypto symbol if applicable (string | null) - e.g., "AAPL", "NVDA", "XRP"
- `macro`: Macro category if applicable (string | null) - e.g., "Central Bank Policy", "Economic Data"
- `sources`: Array of source URLs (string[])
- `publishedDate`: ISO timestamp when report was generated (string)
- `isRelevant`: (optional) `true` if card matches user holdings (only present when personalized)

**Personalization**:
- When `userId` is provided, the API fetches user holdings from the main backend
- Cards with `ticker` matching user holdings are prioritized (placed first)
- Other cards (macro, non-matching holdings) follow after
- `metadata.personalized`: `true` if personalization was applied
- `metadata.userHoldingsCount`: Number of holdings used for personalization

**Error Response**:
```json
{
  "error": "No research results found",
  "message": "No research reports found. Run a research query first."
}
```

**iOS Usage Example**:
```swift
// Without personalization
let url = URL(string: "https://deep-research-production-0185.up.railway.app/api/report/cards")!

// With personalization (recommended)
let userId = "D96C07AD-DA20-457D-9CE5-D687D8BFB3DE"
let url = URL(string: "https://deep-research-production-0185.up.railway.app/api/report/cards?userId=\(userId)")!

URLSession.shared.dataTask(with: url) { data, response, error in
    guard let data = data,
          let json = try? JSONDecoder().decode(ReportResponse.self, from: data) else { return }
    
    // json.cards contains all cards (personalized if userId provided)
    // Cards matching user holdings appear first (isRelevant: true)
    // json.metadata.personalized - true if personalization applied
    // json.metadata.userHoldingsCount - number of holdings used
}
```

---

### 2. Get Latest Report (Markdown Format)

**Endpoint**: `GET /api/report/latest`

**Description**: Returns the latest report in markdown format with parsed cards.

**Response**:
```json
{
  "success": true,
  "runId": "research-1768758513249",
  "timestamp": "1768758513249",
  "opening": "...",
  "cards": [
    {
      "title": "...",
      "content": "...",
      "emoji": "🍎"
    }
  ],
  "sources": ["url1", "url2"],
  "metadata": {
    "totalCards": 3,
    "totalSources": 58,
    "reportPath": "..."
  }
}
```

---

## 🎙️ Podcast Endpoint

### 3. Get Podcast Summary

**Endpoint**: `GET /api/podcast/latest`

**Description**: Returns a 4-minute podcast-style storytelling summary of all research stories.

**Response**:
```json
{
  "success": true,
  "runId": "research-1768758513249",
  "publishedDate": "2026-01-18T17:48:33.249Z",
  "content": "Welcome back to the show, folks! This week's financial landscape is buzzing with shifts—from tech titans embracing AI to central banks recalibrating the economic dial. Grab your headphones, and let's dive in...",
  "metadata": {
    "wordCount": 543,
    "estimatedMinutes": 4,
    "estimatedSeconds": 218
  }
}
```

**Fields**:
- `content`: Full podcast text (ready for text-to-speech) (string)
- `wordCount`: Number of words (integer)
- `estimatedMinutes`: Estimated duration in minutes (integer)
- `estimatedSeconds`: Estimated duration in seconds (integer)

**Error Response**:
```json
{
  "error": "No research data available",
  "message": "Run a research query first to generate podcast content."
}
```

**iOS Usage**: Perfect for text-to-speech or displaying as a transcript.

---

## 💬 Chat Endpoints

### 4. Send Chat Message

**Endpoint**: `POST /api/chat`

**Description**: AI chat with knowledge base. Gen Z financial friend persona - short, smart, conversational.

**Request Body**:
```json
{
  "message": "What happened with Apple this week?",
  "sessionId": "optional-session-id"  // Optional: omit for new session
}
```

**Response**:
```json
{
  "success": true,
  "sessionId": "965a7410-0570-4660-9a88-4ce4d1c1c4a8",
  "message": "Apple went big this week—teaming up with Google to power next-gen AI models while also smashing revenue records in their Services segment. It's a power move that blends AI innovation with their rock-solid recurring income...",
  "metadata": {
    "sessionAge": 3245,
    "messageCount": 2
  }
}
```

**Fields**:
- `sessionId`: Use this to continue the conversation (string)
- `message`: AI response (string)
- `metadata.sessionAge`: Session age in milliseconds (integer)
- `metadata.messageCount`: Number of messages in session (integer)

**Error Response**:
```json
{
  "error": "Message is required"
}
```

**iOS Usage Example**:
```swift
struct ChatRequest: Codable {
    let message: String
    let sessionId: String?
}

struct ChatResponse: Codable {
    let success: Bool
    let sessionId: String
    let message: String
    let metadata: ChatMetadata
}

// Send message
var request = URLRequest(url: URL(string: "https://deep-research-production-0185.up.railway.app/api/chat")!)
request.httpMethod = "POST"
request.setValue("application/json", forHTTPHeaderField: "Content-Type")

let body = ChatRequest(message: "What happened with Apple?", sessionId: savedSessionId)
request.httpBody = try? JSONEncoder().encode(body)

URLSession.shared.dataTask(with: request) { data, response, error in
    // Handle response
}
```

---

### 5. Get Chat Session History

**Endpoint**: `GET /api/chat/session/:sessionId`

**Description**: Retrieve full conversation history for a session.

**Response**:
```json
{
  "success": true,
  "sessionId": "965a7410-0570-4660-9a88-4ce4d1c1c4a8",
  "messages": [
    {
      "role": "user",
      "content": "What happened with Apple?",
      "timestamp": 1705608000000
    },
    {
      "role": "assistant",
      "content": "Apple went big this week...",
      "timestamp": 1705608005000
    }
  ],
  "metadata": {
    "createdAt": 1705608000000,
    "lastAccessed": 1705608100000,
    "messageCount": 2
  }
}
```

---

## 🔬 Research Endpoints (For Admin/Backend Use)

### 6. Run Research

**Endpoint**: `POST /api/research`

**Description**: Triggers a new research query. **Expensive operation** - use sparingly.

**Request Body**:
```json
{
  "query": "Apple stock this week",
  "depth": 3,
  "breadth": 3
}
```

**Response**:
```json
{
  "success": true,
  "answer": "...",
  "learnings": ["...", "..."],
  "visitedUrls": ["url1", "url2"]
}
```

---

### 7. Generate Report (Markdown)

**Endpoint**: `POST /api/generate-report`

**Description**: Generate a markdown report from research.

**Request Body**:
```json
{
  "query": "Apple stock this week",
  "depth": 3,
  "breadth": 3
}
```

**Response**:
```json
{
  "report": "# Report Title\n\n..."
}
```

---

### 8. Generate Report (JSON)

**Endpoint**: `POST /api/generate-report-json`

**Description**: Generate a report and return as JSON with separated cards.

**Request Body**:
```json
{
  "query": "Apple stock this week",
  "depth": 3,
  "breadth": 3
}
```

**Response**:
```json
{
  "success": true,
  "query": "Apple stock this week",
  "runId": "research-1768758513249",
  "opening": "...",
  "cards": [...],
  "sources": [...],
  "metadata": {
    "totalCards": 3,
    "totalSources": 58,
    "totalLearnings": 15
  }
}
```

---

## 📱 Recommended iOS Implementation

### Primary Endpoints for iOS App

1. **`GET /api/report/cards`** - Main endpoint for displaying reports
   - Returns cards with ticker, macro, sources, dates
   - Perfect for card-based UI

2. **`GET /api/podcast/latest`** - Podcast summary
   - Use for audio/text-to-speech feature
   - 4-minute summary of all stories

3. **`POST /api/chat`** - AI chat
   - Financial friend chat feature
   - Save `sessionId` to continue conversations

### Data Models (Swift)

```swift
struct ReportCardsResponse: Codable {
    let success: Bool
    let runId: String
    let publishedDate: String
    let opening: String
    let cards: [ReportCard]
    let metadata: ReportMetadata
}

struct ReportCard: Codable {
    let title: String
    let content: String
    let emoji: String?
    let ticker: String?
    let macro: String?
    let sources: [String]
    let publishedDate: String
}

struct ReportMetadata: Codable {
    let totalCards: Int
    let totalSources: Int
    let holdingsCards: Int
    let macroCards: Int
}

struct ChatRequest: Codable {
    let message: String
    let sessionId: String?
}

struct ChatResponse: Codable {
    let success: Bool
    let sessionId: String
    let message: String
    let metadata: ChatMetadata
}

struct ChatMetadata: Codable {
    let sessionAge: Int
    let messageCount: Int
}

struct PodcastResponse: Codable {
    let success: Bool
    let runId: String
    let publishedDate: String
    let content: String
    let metadata: PodcastMetadata
}

struct PodcastMetadata: Codable {
    let wordCount: Int
    let estimatedMinutes: Int
    let estimatedSeconds: Int
}
```

---

## 🔐 Authentication

Currently **no authentication required**. All endpoints are public.

---

## ⚠️ Error Handling

All endpoints may return:

```json
{
  "error": "Error type",
  "message": "Detailed error message"
}
```

**Common HTTP Status Codes**:
- `200` - Success
- `400` - Bad Request (missing required fields)
- `404` - Not Found (no data available)
- `500` - Server Error

---

## 📝 Notes

- **Data Source**: Reports are stored in PostgreSQL database (persistent)
- **Chat Sessions**: Stored in database (persistent across deployments)
- **Latest Report**: Always returns the most recent research report
- **CORS**: Enabled for all origins
- **Rate Limiting**: None currently (consider adding for production)

---

## 🧪 Testing

Test endpoints:
```bash
# Report Cards
curl https://deep-research-production-0185.up.railway.app/api/report/cards

# Podcast
curl https://deep-research-production-0185.up.railway.app/api/podcast/latest

# Chat
curl -X POST https://deep-research-production-0185.up.railway.app/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What happened with Apple?"}'
```
