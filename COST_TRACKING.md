# Cost Tracking

All OpenAI (and Fireworks) token usage, plus Firecrawl credits, are saved in the database so you can run analysis later (by date, run, service, operation, or model).

**Requirement:** Cost logs are only persisted when `DATABASE_URL` is set. Without it, each call is logged to the console only (e.g. `[cost-logger] No DB: openai chat ... cost=$0.00xx (set DATABASE_URL to persist)`). Set `DATABASE_URL` and ensure the schema (including `cost_logs`) is initialized so `GET /api/cost-logs` and CSV export work.

**Local vs Railway:** Locally, the API loads `.env.local` when `DATABASE_URL` is not set ([src/load-env.ts](src/load-env.ts)), so cost logging works with `tsx src/api.ts` or `npm run start:api`. On Railway, set `DATABASE_URL` (and `OPENAI_KEY`, etc.) in the service variables; the app uses `process.env` and does not load any file.

**If chat costs don’t show up (and DATABASE_URL is set):** (1) Check server logs for `[cost-logger] Inserted chat cost $X.XX` — if you see it, the row was written (filter cost logs by `operation=chat` and recent time). (2) If you see `[cost-logger] Async LLM log failed`, the insert failed (e.g. DB error or budget rejected). (3) If `OPENAI_DAILY_BUDGET_USD` is set and today’s total would be exceeded, the insert is rejected (you’ll see "OpenAI daily budget exceeded"). (4) When the API has no `OPENAI_KEY`, chat uses the fallback and logs as operation `generateText`, not `chat` — filter by `service=openai` and check both `chat` and `generateText`.

## What is tracked

- **OpenAI / Fireworks (LLM):** Each call logs `input_tokens`, `output_tokens`, and computed USD to the `cost_logs` table. One row per API call.
- **Firecrawl:** Credit-based usage (e.g. scrape/crawl pages) is logged with `usage_credits` and estimated USD.

## Where costs are logged

- **Vercel AI SDK calls** – All `generateText` and `generateObject` calls go through [src/ai/generate-with-cost-log.ts](src/ai/generate-with-cost-log.ts), which logs after each call. Used by: deep-research, holdings-queries, feedback, content-scoring, pipeline-logger, wealthy-rabbit-report, and the API (chat fallback, podcast).
- **OpenAI Responses API (chat)** – [src/chat-tools.ts](src/chat-tools.ts) logs usage after each `client.responses.create()` call (including each step in multi-step tool runs).
- **OpenAI Responses API (news brief)** – [src/news-brief-openai.ts](src/news-brief-openai.ts) logs usage after each `client.responses.create()` in single-pass and full workflow.

## How to view and export

- **JSON:** `GET /api/cost-logs`  
  Query params: `limit`, `offset`, `service`, `runId`, `since` (ISO date), `breakdown=true` for per-row breakdown fields. Response includes `logs` and `summary` (totalCost, byService, byOperation).
- **CSV:** `GET /api/cost-logs/csv`  
  Same query params; returns CSV with columns: id, service, operation, model, firecrawl_credits_used, firecrawl_effective_usd_per_credit, openai_input_tokens, openai_output_tokens, openai_input_rate, openai_output_rate, total_cost_usd, run_id, created_at.

For analysis you can also query the `cost_logs` table directly (e.g. by `created_at`, `run_id`, `service`, `operation`, `model`).

## Configuration

Defined in [src/cost-config.ts](src/cost-config.ts):

- **OpenAI (token-based):**
  - `OPENAI_INPUT_USD_PER_1M` – default input price per 1M tokens (USD)
  - `OPENAI_OUTPUT_USD_PER_1M` – default output price per 1M tokens (USD)
  - Per-model overrides are in `openaiModelOverrides` (e.g. gpt-4, o1, gpt-4o). Model id matching is by substring (e.g. `gpt-4` matches `gpt-4o-mini`).
- **Firecrawl (credit-based):**
  - `FIRECRAWL_PLAN_PRICE_USD` – plan price in USD
  - `FIRECRAWL_MONTHLY_CREDITS` – monthly credit bucket

## Schema

Table: `cost_logs` (see [src/db/schema.sql](src/db/schema.sql)).

Columns: `id`, `service`, `operation`, `model`, `input_tokens`, `output_tokens`, `count`, `cost_per_unit`, `total_cost`, `usage_credits`, `run_id`, `metadata`, `created_at`.

- For LLM rows: `service` is `openai` or `fireworks`, `operation` describes the feature (e.g. `generateObject`, `chat`, `newsBriefSingle`), `input_tokens`/`output_tokens` and `total_cost` are set, `usage_credits` is null.
- For Firecrawl rows: `service` is `firecrawl`, `usage_credits` is set, token columns are null.

## Cost control

Optional env vars (see [ENV_VARIABLES.md](ENV_VARIABLES.md) for full list):

- **Output caps:** `OPENAI_MAX_OUTPUT_TOKENS` (Vercel AI SDK), `OPENAI_MAX_COMPLETION_TOKENS` (Responses API). When set, responses are truncated at that many tokens; set high or leave unset to preserve quality.
- **Chat:** `CHAT_MODEL` (default `gpt-4o-mini`), `CHAT_MAX_STEPS` (default 5).
- **Daily budget:** `OPENAI_DAILY_BUDGET_USD`. When set, before inserting each OpenAI or Fireworks cost, the app queries today’s sum (server date) for `service IN ('openai', 'fireworks')`. If adding this call would exceed the budget, it throws `OpenAI daily budget exceeded` and does not insert the row. Callers can catch and return a user-facing message.
