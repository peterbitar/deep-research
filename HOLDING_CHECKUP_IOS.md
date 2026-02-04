# Holding Checkup API — iOS Integration

How to call the investor checkup from your iOS app when the user taps “Check up” on a holding.

---

## Endpoint

| Method | Path |
|--------|------|
| **POST** | `{baseURL}/api/holding-checkup` |

**Base URL:** Your deep-research API root (e.g. `https://your-deep-research.up.railway.app`).

---

## Request

**Headers**
- `Content-Type: application/json`

**Body (JSON)**

| Field   | Type   | Required | Description |
|---------|--------|----------|-------------|
| `symbol` | string | **Yes** | Ticker or symbol (e.g. `"AAPL"`, `"BTC"`, `"SPY"`). |
| `type`   | string | No       | `"stock"` \| `"crypto"` \| `"etf"` \| `"commodity"`. If omitted, inferred from symbol (e.g. BTC → crypto). |
| `name`   | string | No       | Display name (e.g. `"Apple"`, `"Bitcoin"`) for friendlier checkup text. |

**Examples**

```json
{ "symbol": "AAPL", "name": "Apple" }
{ "symbol": "BTC", "type": "crypto", "name": "Bitcoin" }
{ "symbol": "PLTR", "type": "stock", "name": "Palantir" }
{ "symbol": "SPY", "type": "etf" }
```

---

## Response

**Success (200)**

```json
{
  "success": true,
  "checkup": "As of Feb 3, 2026, BTC is trading at $78,323...\n\n🧠 **Activity + Developer Signals**\n...",
  "assetType": "crypto",
  "symbol": "BTC",
  "newsBriefUsed": true,
  "webSearchUsed": true,
  "citationUrls": ["https://example.com/article", "https://..."]
}
```

| Field           | Type    | Description |
|-----------------|---------|-------------|
| `success`       | boolean | Always `true` on 200. |
| `checkup`       | string  | Markdown-style checkup (intro + emoji sections). Display in a text view; supports `**bold**` and newlines. |
| `assetType`     | string  | `"stock"` \| `"crypto"` \| `"etf"` \| `"commodity"`. |
| `symbol`        | string  | Echo of the requested symbol. |
| `newsBriefUsed` | boolean | Present and `true` when latest report cards were used for context. |
| `webSearchUsed` | boolean | `true` when checkup used web search; `false` when fallback only. |
| `citationUrls`  | array   | Optional. Source URLs when web search was used (e.g. for “Sources” link). |

**Error (4xx / 5xx)**

```json
{
  "error": "symbol is required (string)"
}
```

```json
{
  "error": "An error occurred generating the checkup",
  "message": "OpenAI daily budget exceeded"
}
```

- **400** — Missing or invalid `symbol`.
- **500** — Server or model error; `message` has detail.

---

## Swift / URLSession Example

```swift
struct HoldingCheckupRequest: Encodable {
    let symbol: String
    var type: String? = nil
    var name: String? = nil
}

struct HoldingCheckupResponse: Decodable {
    let success: Bool
    let checkup: String
    let assetType: String
    let symbol: String
    let newsBriefUsed: Bool?
    let webSearchUsed: Bool?
    let citationUrls: [String]?
}

func fetchCheckup(symbol: String, type: String? = nil, name: String? = nil) async throws -> HoldingCheckupResponse {
    let baseURL = "https://your-deep-research.up.railway.app"
    let url = URL(string: "\(baseURL)/api/holding-checkup")!
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.httpBody = try JSONEncoder().encode(HoldingCheckupRequest(symbol: symbol, type: type, name: name))

    let (data, response) = try await URLSession.shared.data(for: request)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    guard http.statusCode == 200 else {
        struct ErrorBody: Decodable { let error: String?; let message: String? }
        if let err = try? JSONDecoder().decode(ErrorBody.self, from: data) {
            throw CheckupError.server(err.message ?? err.error ?? "Unknown error")
        }
        throw CheckupError.status(http.statusCode)
    }
    return try JSONDecoder().decode(HoldingCheckupResponse.self, from: data)
}

// Usage (e.g. from a “Check up” button on a holding row)
Task {
    do {
        let res = try await fetchCheckup(symbol: "BTC", type: "crypto", name: "Bitcoin")
        // Show res.checkup in a sheet or push (e.g. Text(res.checkup) with markdown)
        // Optionally show res.citationUrls as “Sources”
    } catch { ... }
}
```

---

## UI Notes

- **Checkup text:** `checkup` is plain text with newlines and `**bold**`; you can render it in a `Text` view or use a simple markdown renderer for the headers.
- **Loading:** The call can take 15–30+ seconds (web search + model). Show a loading state and consider a timeout (e.g. 60s).
- **Citations:** If `citationUrls` is non-empty, show a “Sources” or “Learn more” section with tappable links.
- **Errors:** On 400, show “Please provide a symbol.” On 500, show `message` or a generic “Checkup unavailable; try again later.”
