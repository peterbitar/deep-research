/**
 * Cost logger - tracks LLM (token-based) and Firecrawl (credit-based) costs and persists to DB.
 * Firecrawl: credits_used per run (scrape/crawl = pages scraped; search = 0). Cost = credits * (plan_price / monthly_credits).
 * OpenAI: cost from input/output tokens using config rates.
 * created_at is stored in Eastern (America/New_York).
 */

import { pool } from './db/client';
import { getTodaysOpenAIAndFireworksCost } from './db/cost-logs';

/** Current time in Eastern (EST/EDT) as ISO-like string for PostgreSQL TIMESTAMP. */
function nowEST(): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}
import {
  getFirecrawlEffectiveUsdPerCredit,
  getOpenAIRates,
} from './cost-config';

export type LogLLMCostParams = {
  modelId: string;
  inputTokens: number;
  outputTokens: number;
  operation?: string;
  runId?: string;
};

export async function logLLMCost(params: LogLLMCostParams): Promise<void> {
  const {
    modelId,
    inputTokens,
    outputTokens,
    operation = 'generate',
    runId,
  } = params;

  const { inputPer1M, outputPer1M } = getOpenAIRates(modelId);
  const inputCost = (inputTokens / 1_000_000) * inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * outputPer1M;
  const totalCost = inputCost + outputCost;
  const service = modelId.toLowerCase().includes('fireworks') ? 'fireworks' : 'openai';

  await insertCostLog({
    service,
    operation,
    model: modelId,
    inputTokens,
    outputTokens,
    count: 1,
    costPerUnit: totalCost,
    totalCost,
    usageCredits: null,
    runId,
    metadata: {
      inputCost,
      outputCost,
      openai_input_rate_per_1m: inputPer1M,
      openai_output_rate_per_1m: outputPer1M,
    },
  });
}

export type LogFirecrawlCostParams = {
  operation: 'search' | 'scrape' | 'crawl';
  /** Credits used this call: search=0, scrape/crawl=pages_scraped_successfully (default 1 per call) */
  creditsUsed?: number;
  runId?: string;
};

export async function logFirecrawlCost(params: LogFirecrawlCostParams): Promise<void> {
  const { operation, runId } = params;
  const creditsUsed =
    operation === 'search' ? 0 : Math.max(0, params.creditsUsed ?? 1);

  const effectiveUsdPerCredit = getFirecrawlEffectiveUsdPerCredit();
  const estimatedCostUsd = creditsUsed * effectiveUsdPerCredit;

  await insertCostLog({
    service: 'firecrawl',
    operation,
    model: null,
    inputTokens: null,
    outputTokens: null,
    count: creditsUsed,
    costPerUnit: effectiveUsdPerCredit,
    totalCost: estimatedCostUsd,
    usageCredits: creditsUsed,
    runId,
    metadata: {
      firecrawl_credits_used: creditsUsed,
      firecrawl_effective_usd_per_credit: effectiveUsdPerCredit,
    },
  });
}

type InsertParams = {
  service: string;
  operation: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  count: number;
  costPerUnit: number;
  totalCost: number;
  usageCredits: number | null;
  runId?: string;
  metadata: Record<string, unknown>;
};

async function insertCostLog(params: InsertParams): Promise<void> {
  if (!pool) {
    console.log(
      `[cost-logger] No DB: ${params.service} ${params.operation} ${params.model ?? ''} cost=$${params.totalCost.toFixed(4)} (set DATABASE_URL to persist)`
    );
    return;
  }

  const budgetUsd = process.env.OPENAI_DAILY_BUDGET_USD?.trim();
  if (budgetUsd && (params.service === 'openai' || params.service === 'fireworks')) {
    const budget = parseFloat(budgetUsd);
    if (Number.isFinite(budget) && budget > 0) {
      try {
        const todaysSum = await getTodaysOpenAIAndFireworksCost();
        if (todaysSum + params.totalCost > budget) {
          console.warn(
            `[cost-logger] OpenAI daily budget exceeded: today=$${todaysSum.toFixed(4)}, this call=$${params.totalCost.toFixed(4)}, budget=$${budget}`
          );
          throw new Error('OpenAI daily budget exceeded');
        }
      } catch (err) {
        if (err instanceof Error && err.message === 'OpenAI daily budget exceeded') throw err;
        console.warn('[cost-logger] Budget check failed (will insert anyway):', err);
      }
    }
  }

  const metadata = JSON.stringify({
    ...params.metadata,
    ...(params.usageCredits != null && { usage_credits: params.usageCredits }),
  });
  const createdAt = nowEST();
  const fullParams = [
    params.service,
    params.operation,
    params.model,
    params.inputTokens,
    params.outputTokens,
    params.count,
    params.costPerUnit,
    params.totalCost,
    params.usageCredits,
    params.runId ?? null,
    metadata,
    createdAt,
  ];
  const fallbackParams = [
    params.service,
    params.operation,
    params.model,
    params.inputTokens,
    params.outputTokens,
    params.count,
    params.costPerUnit,
    params.totalCost,
    params.runId ?? null,
    metadata,
    createdAt,
  ];
  try {
    await pool.query(
      `INSERT INTO cost_logs (service, operation, model, input_tokens, output_tokens, count, cost_per_unit, total_cost, usage_credits, run_id, metadata, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      fullParams
    );
    if (params.operation === 'chat') {
      console.log(`[cost-logger] Inserted chat cost $${params.totalCost.toFixed(4)} (${params.inputTokens} in / ${params.outputTokens} out)`);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('usage_credits') && msg.includes('does not exist')) {
      try {
        await pool.query(
          `INSERT INTO cost_logs (service, operation, model, input_tokens, output_tokens, count, cost_per_unit, total_cost, run_id, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          fallbackParams
        );
      } catch (fallbackErr) {
        console.error('[cost-logger] Failed to insert cost log (fallback):', fallbackErr);
      }
    } else {
      console.error('[cost-logger] Failed to insert cost log:', err);
    }
  }
}

export function logLLMCostAsync(params: LogLLMCostParams): void {
  logLLMCost(params).catch((err) =>
    console.error('[cost-logger] Async LLM log failed:', err)
  );
}

export function logFirecrawlCostAsync(params: LogFirecrawlCostParams): void {
  logFirecrawlCost(params).catch((err) =>
    console.error('[cost-logger] Async Firecrawl log failed:', err)
  );
}
