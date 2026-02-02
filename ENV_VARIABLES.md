# Environment Variables Required for Deployment

**Chat and report cards read config from `process.env` only** — no `.env.local` is read at runtime. In Railway, set all variables in **Project → Service → Variables**. Locally, use `.env.local` (or `--env-file=.env.local`) so your runner injects them into `process.env` before the app starts.

## 🔴 REQUIRED Variables

### AI Model (Choose ONE - Required)

**Option 1: OpenAI**
```
OPENAI_KEY=sk-...
```
- Get from: https://platform.openai.com/api-keys
- Used for: o3-mini model (default if no other model set)

**Option 2: Fireworks (Recommended - DeepSeek R1)**
```
FIREWORKS_KEY=...
```
- Get from: https://fireworks.ai/
- Used for: DeepSeek R1 model (better reasoning)

**Option 3: Custom OpenAI Model**
```
CUSTOM_MODEL=your-model-name
OPENAI_KEY=sk-...
OPENAI_ENDPOINT=https://api.openai.com/v1  # Optional, defaults to OpenAI
```
- Used for: Custom OpenAI-compatible models

---

### Firecrawl (Required for Web Scraping)

```
FIRECRAWL_KEY=fc-...
```
- Get from: https://firecrawl.dev/
- Used for: Web scraping and article extraction
- **This is REQUIRED** - the API won't work without it

```
FIRECRAWL_BASE_URL=https://api.firecrawl.dev  # Optional
```
- Defaults to: Firecrawl cloud API
- Only set if using self-hosted Firecrawl

---

## 🟡 Optional Variables

### Server Configuration

```
PORT=3051  # Optional, defaults to 3051
```
- Port the API server runs on
- Railway/Render will set this automatically

### Performance Tuning

```
CONTEXT_SIZE=128000  # Optional, defaults to 128000
```
- Maximum context size for LLM prompts
- Increase if you need longer context

```
FIRECRAWL_CONCURRENCY=2  # Optional, defaults to 2
```
- Number of concurrent Firecrawl requests
- Increase if you have higher rate limits

### Report cards: holdings personalization (optional)

```
MAIN_BACKEND_URL=https://wealthyrabbitios-production-03a4.up.railway.app
```
- Used for: `GET /api/report/cards?userId=xxx` — fetches user holdings from main backend to personalize card order
- Set in Railway Variables so report cards use your main backend; omit to use the default URL

---

### Chat: live prices (optional but recommended)

Set these **in Railway Variables** (and in `.env.local` for local dev) so the chat can return live stock and crypto prices. Without them, chat falls back to Yahoo Finance only (which may timeout from Railway).

**Stocks (Finnhub)** – set in Railway + `.env.local`:
```
FINNHUB_KEY=your-finnhub-api-key
```
- Get from: https://finnhub.io/register
- Used for: US stock prices in chat (MSFT, NVDA, AAPL, etc.)
- Also accepted: `FINNHUB_API_KEY`

**Crypto (FreeCryptoAPI)** – set in Railway + `.env.local`:
```
FREECRYPTOAPI_KEY=your-freecryptoapi-token
```
- Get from: https://freecryptoapi.com/
- Used for: Crypto prices in chat (BTC, ETH, SOL, DOGE, XRP)
- Also accepted: `FREECRYPTOAPI_TOKEN`, `FREECRYPTOAPI_API_KEY`

**Chat (web search + tools)** – set in Railway + `.env.local`:
```
OPENAI_KEY=sk-...
```
- Required for: Chat with web search and price tools on production
- Without it, chat uses a fallback model with no tools (e.g. “I can’t fetch price”)

---

### Cost tracking (optional)

Firecrawl is credit-based; cost is derived from your plan and credits used per run.

```
FIRECRAWL_PLAN_PRICE_USD=113       # Optional, defaults to 113
FIRECRAWL_MONTHLY_CREDITS=100000   # Optional, defaults to 100000
```
- Used to compute effective cost per credit: `plan_price / monthly_credits`
- Each successful scrape/crawl page ≈ 1 credit; search = 0 credits

OpenAI costs are token-based. Set rates (USD per 1M tokens) to match your billing:

```
OPENAI_INPUT_USD_PER_1M=0.15   # Optional, defaults to 0.15
OPENAI_OUTPUT_USD_PER_1M=0.6   # Optional, defaults to 0.6
```

---

## 📋 Complete Example (Railway/Render)

Copy-paste these into your deployment platform's environment variables:

### Minimum Required (OpenAI + Firecrawl):
```
OPENAI_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FIRECRAWL_KEY=fc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Recommended (Fireworks + Firecrawl):
```
FIREWORKS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FIRECRAWL_KEY=fc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Full Configuration (All Optional):
```
FIREWORKS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FIRECRAWL_KEY=fc-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FIRECRAWL_BASE_URL=https://api.firecrawl.dev
PORT=3051
CONTEXT_SIZE=128000
FIRECRAWL_CONCURRENCY=2
```

### Chat + live prices (set in Railway and in .env.local):
```
OPENAI_KEY=sk-proj-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FINNHUB_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
FREECRYPTOAPI_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

---

## 🔑 Where to Get Keys

1. **OpenAI Key**: https://platform.openai.com/api-keys
   - Sign up → API Keys → Create new secret key

2. **Fireworks Key**: https://fireworks.ai/
   - Sign up → Dashboard → API Keys

3. **Firecrawl Key**: https://firecrawl.dev/
   - Sign up → Dashboard → API Keys

---

## ✅ Quick Checklist

Before deploying, make sure you have:
- [ ] At least ONE AI model key (OPENAI_KEY OR FIREWORKS_KEY)
- [ ] FIRECRAWL_KEY (required for research functionality)
- [ ] All keys are valid and have credits/quota
- [ ] **Railway**: Same vars as `.env.local` (e.g. OPENAI_KEY, FINNHUB_KEY, FREECRYPTOAPI_KEY) so chat and live prices work in production

---

## 🚨 Important Notes

- **Never commit these keys to git** - they're in `.gitignore`
- **Set them in your deployment platform** (Railway, Render, etc.) – e.g. Railway → Project → Service → **Variables**. The app reads **only** `process.env`; Railway injects these at runtime.
- **Set the same keys in `.env.local`** for local testing; your runner (e.g. `tsx --env-file=.env.local`) loads them into `process.env` before the app starts.
- **Firecrawl is REQUIRED** - the research endpoints won't work without it
- **Chat and cards**: For production, set OPENAI_KEY, FINNHUB_KEY, FREECRYPTOAPI_KEY, MAIN_BACKEND_URL (and DATABASE_URL) in **Railway Variables** — the code does not read `.env.local` at runtime.
