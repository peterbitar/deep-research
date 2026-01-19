# API Quick Reference for iOS

**Base URL**: `https://deep-research-production-0185.up.railway.app`

---

## 🎯 Essential Endpoints (Use These)

### 1. Get Report Cards ⭐ **PRIMARY ENDPOINT**
```
GET /api/report/cards
```
**What it does**: Returns latest report with cards, ticker, macro, sources, dates  
**Use for**: Main feed/screen in your app

**Response Structure**:
- `cards[]` - Array of cards
  - `title`, `content`, `emoji`
  - `ticker` (e.g., "AAPL", "NVDA") or `null`
  - `macro` (e.g., "Central Bank Policy") or `null`
  - `sources[]` - Array of URLs
  - `publishedDate` - ISO timestamp

---

### 2. Get Podcast Summary
```
GET /api/podcast/latest
```
**What it does**: 4-minute podcast-style summary  
**Use for**: Audio/text-to-speech feature

**Response**:
- `content` - Full podcast text
- `metadata.wordCount` - Word count
- `metadata.estimatedMinutes` - Duration

---

### 3. Chat with AI
```
POST /api/chat
Body: { "message": "Your question", "sessionId": "optional" }
```
**What it does**: AI chat with financial knowledge base  
**Use for**: Chat feature in your app

**Response**:
- `sessionId` - Save this to continue conversation
- `message` - AI response
- `metadata.messageCount` - Messages in session

---

## 📋 All Endpoints Summary

| Method | Endpoint | Purpose | iOS Use |
|--------|----------|---------|---------|
| `GET` | `/api/report/cards` | Get report cards with metadata | ✅ **Main feed** |
| `GET` | `/api/podcast/latest` | Get podcast summary | ✅ Audio feature |
| `POST` | `/api/chat` | AI chat | ✅ Chat feature |
| `GET` | `/api/chat/session/:id` | Get chat history | ✅ Chat history |
| `GET` | `/api/report/latest` | Get latest report (markdown) | Optional |
| `POST` | `/api/research` | Run research (expensive) | ❌ Backend only |
| `POST` | `/api/generate-report` | Generate report | ❌ Backend only |
| `POST` | `/api/generate-report-json` | Generate report JSON | ❌ Backend only |

---

## 🔑 Key Data Fields

### Card Object
```swift
struct Card {
    let title: String           // "Apple AI & Service Growth"
    let content: String         // Full card text
    let emoji: String?          // "🍎"
    let ticker: String?         // "AAPL" or nil
    let macro: String?          // "Central Bank Policy" or nil
    let sources: [String]        // Array of URLs
    let publishedDate: String   // ISO timestamp
}
```

### Filtering Cards
- **Holdings**: `cards.filter { $0.ticker != nil }`
- **Macro**: `cards.filter { $0.macro != nil }`
- **By Ticker**: `cards.filter { $0.ticker == "AAPL" }`
- **By Macro**: `cards.filter { $0.macro == "Central Bank Policy" }`

---

## 📱 Swift Example

```swift
import Foundation

struct API {
    static let baseURL = "https://deep-research-production-0185.up.railway.app"
    
    // Get Report Cards
    static func getReportCards(completion: @escaping (Result<ReportCardsResponse, Error>) -> Void) {
        let url = URL(string: "\(baseURL)/api/report/cards")!
        URLSession.shared.dataTask(with: url) { data, response, error in
            if let error = error {
                completion(.failure(error))
                return
            }
            guard let data = data,
                  let response = try? JSONDecoder().decode(ReportCardsResponse.self, from: data) else {
                completion(.failure(NSError(domain: "API", code: -1)))
                return
            }
            completion(.success(response))
        }.resume()
    }
    
    // Send Chat Message
    static func sendChat(message: String, sessionId: String?, completion: @escaping (Result<ChatResponse, Error>) -> Void) {
        let url = URL(string: "\(baseURL)/api/chat")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = ChatRequest(message: message, sessionId: sessionId)
        request.httpBody = try? JSONEncoder().encode(body)
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            // Handle response
        }.resume()
    }
}
```

---

## 🎨 UI Recommendations

### Card Display
- Show `emoji` as icon
- Show `title` as header
- Show `content` as body
- Show `ticker` or `macro` as badge/tag
- Link `sources` to open URLs

### Filtering
- Tab 1: "All Cards"
- Tab 2: "Holdings" (filter by `ticker != nil`)
- Tab 3: "Macro" (filter by `macro != nil`)
- Search: Filter by `ticker` or `macro` value

---

## ⚠️ Error Handling

All endpoints may return:
```json
{
  "error": "Error type",
  "message": "Error message"
}
```

**Handle**:
- `404` - No data available (show empty state)
- `500` - Server error (show error message)
- Network errors - Show retry option

---

## 🔄 Data Refresh

- **Report Cards**: Refresh when app opens or user pulls to refresh
- **Podcast**: Refresh when user requests it
- **Chat**: Real-time (send message, get response)

---

## 📊 Response Times

- Report Cards: ~100-500ms
- Podcast: ~2-5 seconds (generates on-demand)
- Chat: ~2-4 seconds (AI generation)

---

For full documentation, see `API_DOCUMENTATION.md`
