# News brief pipeline (OpenAI web search)

Separate pipeline that uses OpenAI Responses API web search to produce the same cards as the main pipeline, without modifying the existing pipeline.

**Setup:** Run `npm install` so the `openai` package is installed (required for the Responses API).

## Flow

1. **Holdings from users:** Fetches users from the holdings API, then fetches holdings per user and dedupes by symbol. Optional: set `RESEARCH_SYMBOLS` for testing with a predefined list.
2. **OpenAI web search:** One call per run with mode `non-reasoning`, `agentic`, or `deep-research`. Model uses the web_search tool to get today’s news for the holdings (and optional macro).
3. **Cards:** Learnings are saved, then `writeFinalReport` and `saveReport` produce the same `report_cards` format so the app can show them via `getReportCards(runId)`.

## Usage

```bash
npm run news-brief
```

With mode (default: `non-reasoning`):

```bash
NEWS_BRIEF_MODE=agentic npm run news-brief
NEWS_BRIEF_MODE=deep-research npm run news-brief
```

Optional testing with predefined symbols (no users API):

```bash
RESEARCH_SYMBOLS=SPY,BTC npm run news-brief
```

## Env vars

| Var | Description |
|-----|-------------|
| `NEWS_BRIEF_MODE` | `non-reasoning` \| `agentic` \| `deep-research` (default: `non-reasoning`) |
| `NEWS_BRIEF_MACRO` | `1` or `true` to include macro in the prompt (default: true) |
| `RESEARCH_SYMBOLS` | Optional. Comma-separated symbols for testing (e.g. `SPY,BTC`); otherwise holdings come from users. |
| `MAIN_BACKEND_URL` or `HOLDINGS_API_BASE_URL` | Holdings API base URL (for fetching users and holdings). |
| `OPENAI_KEY` or `OPENAI_API_KEY` | OpenAI API key for Responses API. |
| `DATABASE_URL` | PostgreSQL connection string. |

## Run IDs and comparison

- Run IDs are `news-openai-{mode}-{timestamp}` (e.g. `news-openai-non-reasoning-1738412345678`).
- Main pipeline run IDs are `research-{timestamp}`.
- Same DB and app: use `getReportCards(runId)` for any run_id to compare.

## After running

- View cards in the app for the printed run ID.
- Optionally run the existing rewrite step: `npm run rewrite-report <run_id>`.
