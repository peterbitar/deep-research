# Environment Variables Required for Deployment

**Local:** The API loads `.env.local` (or `.env`) automatically when `DATABASE_URL` is not already set, so you can run `npm run start:api` or `tsx src/api.ts` and get DB + cost logging without `--env-file`. You can still use `npm run api` (or `tsx --env-file=.env.local src/api.ts`) to load `.env.local` explicitly.

**Railway:** Set all variables in **Project → Service → Variables**. The app does not load any env file in production; it uses `process.env` from the platform. Cost logging and chat work when `DATABASE_URL` and `OPENAI_KEY` (or `FIREWORKS_KEY`) are set in the Railway dashboard.

## 🔴 REQUIRED Variables

### AI Model (Choose ONE - Required)

**Option 1: OpenAI**
```
OPENAI_KEY=sk-...
DEFAULT_MODEL=gpt-4o-mini  # Optional, defaults to gpt-4o-mini. Set to o3-mini or any model to override.
```
- Get from: https://platform.openai.com/api-keys
- Used for: gpt-4o-mini (default) or model from DEFAULT_MODEL
- Set `DEFAULT_MODEL=o3-mini` for reasoning; `DEFAULT_MODEL=gpt-4o-mini` for lower cost (default)

**Option 2: Fireworks (Recommended - DeepSeek R1)**
```
FIREWORKS_KEY=...
```
- Get from: https://fireworks.ai/
- Used for: DeepSeek R1 model (better reasoning)

**Option 3: Custom OpenAI Model (full override)**
```
CUSTOM_MODEL=your-model-name
OPENAI_KEY=sk-...
OPENAI_ENDPOINT=https://api.openai.com/v1  # Optional, defaults to OpenAI
```
- Used for: Custom OpenAI-compatible models; takes precedence over DEFAULT_MODEL

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

**Cost control (optional):**

- `OPENAI_MAX_OUTPUT_TOKENS` – Cap output tokens for Vercel AI SDK calls (generateText/generateObject). Leave unset for no cap. Set to a generous value (e.g. 8192) to limit runaway cost without truncating normal responses.
- `OPENAI_MAX_COMPLETION_TOKENS` – Cap completion tokens for OpenAI Responses API (chat, news brief). Leave unset for no cap.
- `CHAT_MODEL` – Model for chat (default `gpt-4o-mini`). Override to use a different model (e.g. `gpt-4o`).
- `CHAT_MAX_STEPS` – Max tool-call steps for chat (default 5). Lower values reduce cost but may cut off multi-step tool use.
- `OPENAI_DAILY_BUDGET_USD` – When set, reject new OpenAI/Fireworks LLM calls if today’s logged cost plus the current call would exceed this amount (USD). Throws so callers can return a “budget exceeded” response.

For cost-conscious defaults: keep `DEFAULT_MODEL=gpt-4o-mini` and use the optional caps above.

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

## 🚂 Variables to add on Railway

Set these in **Railway → Project → Service → Variables** (no `.env` file is read in production).

**Required (minimum):**

| Variable       | Purpose |
|----------------|---------|
| `DATABASE_URL` | Postgres connection string (Railway Postgres provides this if you add the plugin). Needed for cost logs, reports, chat sessions. |
| `OPENAI_KEY` or `FIREWORKS_KEY` | At least one AI provider for research, chat, news-brief. |
| `FIRECRAWL_KEY` | Web scraping; required for research and news-brief. |

**Recommended (chat + report cards + live prices):**

| Variable            | Purpose |
|---------------------|---------|
| `OPENAI_KEY`        | Chat with web search and price tools (Responses API). |
| `FINNHUB_KEY`       | Live stock prices in chat (e.g. AAPL, NVDA). |
| `FREECRYPTOAPI_KEY` | Live crypto prices in chat (e.g. BTC, ETH). |
| `MAIN_BACKEND_URL`  | URL of your main app for report cards and user holdings (e.g. `https://your-app.up.railway.app`). |

**Optional (cost control):**

| Variable                      | Purpose |
|-------------------------------|---------|
| `OPENAI_DAILY_BUDGET_USD`     | Hard daily cap (USD); reject new LLM calls when today’s cost would exceed it. |
| `OPENAI_MAX_OUTPUT_TOKENS`    | Cap for research/report output (e.g. `8192`). |
| `OPENAI_MAX_COMPLETION_TOKENS`| Cap for chat and news-brief. |
| `CHAT_MODEL`                  | Chat model (default `gpt-4o-mini`). |
| `CHAT_MAX_STEPS`              | Max tool steps for chat (default `5`). |
| `NEWS_BRIEF_MODEL`            | Model for news-brief card/opening generation (default `gpt-4o-mini`). Overrides `DEFAULT_MODEL` for that path only. |
| `OPENAI_INPUT_USD_PER_1M`     | Override input $/1M tokens for cost tracking only. |
| `OPENAI_OUTPUT_USD_PER_1M`    | Override output $/1M tokens for cost tracking only. |

Copy-paste for Railway (add in Variables, set your values):

```
OPENAI_DAILY_BUDGET_USD=        # e.g. 10 = reject when today > $10
OPENAI_MAX_OUTPUT_TOKENS=       # e.g. 8192
OPENAI_MAX_COMPLETION_TOKENS=   # e.g. 4096
CHAT_MODEL=                     # default gpt-4o-mini
CHAT_MAX_STEPS=                 # default 5
NEWS_BRIEF_MODEL=               # default gpt-4o-mini (card/opening only)
OPENAI_INPUT_USD_PER_1M=        # optional, for cost tracking display
OPENAI_OUTPUT_USD_PER_1M=       # optional, for cost tracking display
```

**Optional (other):**

| Variable                 | Purpose |
|--------------------------|---------|
| `PORT`                   | Railway usually sets this. Default `3051`. |
| `DEFAULT_MODEL`          | Default LLM for research (e.g. `gpt-4o-mini`, `o3-mini`). |
| `CONTEXT_SIZE`           | Max context tokens (default `128000`). |
| `FIRECRAWL_PLAN_PRICE_USD` / `FIRECRAWL_MONTHLY_CREDITS` | For Firecrawl cost tracking. |

---

## ✅ Quick Checklist

Before deploying, make sure you have:
- [ ] At least ONE AI model key (OPENAI_KEY OR FIREWORKS_KEY)
- [ ] FIRECRAWL_KEY (required for research functionality)
- [ ] DATABASE_URL (for cost logs, reports, chat sessions)
- [ ] **Railway**: OPENAI_KEY, FINNHUB_KEY, FREECRYPTOAPI_KEY, MAIN_BACKEND_URL so chat and live prices work in production

---

## 🚨 Important Notes

- **Never commit these keys to git** - they're in `.gitignore`
- **Set them in your deployment platform** (Railway, Render, etc.) – e.g. Railway → Project → Service → **Variables**. The app reads **only** `process.env`; Railway injects these at runtime.
- **Set the same keys in `.env.local`** for local testing; your runner (e.g. `tsx --env-file=.env.local`) loads them into `process.env` before the app starts.
- **Firecrawl is REQUIRED** - the research endpoints won't work without it
- **Chat and cards**: For production, set OPENAI_KEY, FINNHUB_KEY, FREECRYPTOAPI_KEY, MAIN_BACKEND_URL (and DATABASE_URL) in **Railway Variables** — the code does not read `.env.local` at runtime.
