# Environment Variables Required for Deployment

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

---

## 🚨 Important Notes

- **Never commit these keys to git** - they're in `.gitignore`
- **Set them in your deployment platform** (Railway, Render, etc.)
- **Test locally first** with `.env.local` file
- **Firecrawl is REQUIRED** - the research endpoints won't work without it
