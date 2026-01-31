/**
 * Cost logger - tracks LLM and Firecrawl costs and persists to DB
 */

import { pool } from './db/client';

// Pricing (approximate, varies by provider/plan)
const FIRECRAWL_SEARCH_COST = 0.01;
const FIRECRAWL_SCRAPE_COST = 0.075;

function getLLMRates(modelId: string): { inputPer1M: number; outputPer1M: number } {
  if (!modelId) {
    return { inputPer1M: 0.15, outputPer1M: 0.6 };
  }
  const m = modelId.toLowerCase();
  if (m.includes('r1') || m.includes('fireworks')) {
    return { inputPer1M: 0.2, outputPer1M: 0.8 };
  }
  if (m.includes('gpt-4') || m.includes('o1')) {
    return { inputPer1M: 2.5, outputPer1M: 10.0 };
  }
  // o3-mini, o3, default
  return { inputPer1M: 0.15, outputPer1M: 0.6 };
}

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

  const { inputPer1M, outputPer1M } = getLLMRates(modelId);
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
    runId,
    metadata: { inputCost, outputCost },
  });
}

export type LogFirecrawlCostParams = {
  operation: 'search' | 'scrape';
  count?: number;
  runId?: string;
};

export async function logFirecrawlCost(params: LogFirecrawlCostParams): Promise<void> {
  const { operation, count = 1, runId } = params;
  const costPerUnit = operation === 'search' ? FIRECRAWL_SEARCH_COST : FIRECRAWL_SCRAPE_COST;
  const totalCost = costPerUnit * count;

  await insertCostLog({
    service: 'firecrawl',
    operation,
    model: null,
    inputTokens: null,
    outputTokens: null,
    count,
    costPerUnit,
    totalCost,
    runId,
    metadata: {},
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
  runId?: string;
  metadata: Record<string, unknown>;
};

async function insertCostLog(params: InsertParams): Promise<void> {
  if (!pool) return;
  try {
    await pool.query(
      `INSERT INTO cost_logs (service, operation, model, input_tokens, output_tokens, count, cost_per_unit, total_cost, run_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.service,
        params.operation,
        params.model,
        params.inputTokens,
        params.outputTokens,
        params.count,
        params.costPerUnit,
        params.totalCost,
        params.runId ?? null,
        JSON.stringify(params.metadata),
      ]
    );
  } catch (err) {
    console.error('[cost-logger] Failed to insert cost log:', err);
  }
}

/**
 * Fire-and-forget: log without awaiting. Use when you don't want to block.
 */
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
