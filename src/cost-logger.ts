/**
 * Cost logger - tracks LLM (token-based) and Firecrawl (credit-based) costs and persists to DB.
 * Firecrawl: credits_used per run (scrape/crawl = pages scraped; search = 0). Cost = credits * (plan_price / monthly_credits).
 * OpenAI: cost from input/output tokens using config rates.
 */

import { pool } from './db/client';
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
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO cost_logs (service, operation, model, input_tokens, output_tokens, count, cost_per_unit, total_cost, usage_credits, run_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
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
        JSON.stringify(params.metadata),
      ]
    );
  } catch (err) {
    console.error('[cost-logger] Failed to insert cost log:', err);
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
