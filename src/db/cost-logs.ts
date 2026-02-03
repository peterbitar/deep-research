/**
 * Database functions for cost logs
 */

import { pool } from './client';
import { getFirecrawlEffectiveUsdPerCredit } from '../cost-config';

function toBreakdownRow(row: CostLogRow): CostLogBreakdownRow {
  const meta = (row.metadata || {}) as Record<string, unknown>;
  const totalCostUsd = Number(row.total_cost);
  const usageCredits = row.usage_credits ?? null;
  return {
    ...row,
    firecrawl_credits_used: row.service === 'firecrawl' ? (usageCredits ?? 0) : null,
    firecrawl_effective_usd_per_credit:
      row.service === 'firecrawl'
        ? (meta.firecrawl_effective_usd_per_credit as number) ?? getFirecrawlEffectiveUsdPerCredit()
        : null,
    openai_input_tokens: row.service !== 'firecrawl' ? row.input_tokens : null,
    openai_output_tokens: row.service !== 'firecrawl' ? row.output_tokens : null,
    openai_input_rate:
      row.service !== 'firecrawl'
        ? (meta.openai_input_rate_per_1m as number) ?? null
        : null,
    openai_output_rate:
      row.service !== 'firecrawl'
        ? (meta.openai_output_rate_per_1m as number) ?? null
        : null,
    total_cost_usd: totalCostUsd,
  };
}

export type CostLogRow = {
  id: number;
  service: string;
  operation: string;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  count: number;
  cost_per_unit: number | null;
  total_cost: number;
  usage_credits?: number | null;
  run_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
};

/** Per-row breakdown for CSV/API: service, credits, rates, total_cost_usd */
export type CostLogBreakdownRow = CostLogRow & {
  firecrawl_credits_used: number | null;
  firecrawl_effective_usd_per_credit: number | null;
  openai_input_tokens: number | null;
  openai_output_tokens: number | null;
  openai_input_rate: number | null;
  openai_output_rate: number | null;
  total_cost_usd: number;
};

export type CostSummary = {
  totalCost: number;
  byService: Record<string, number>;
  byOperation: Record<string, number>;
  entryCount: number;
  /** Sum of usage_credits for firecrawl rows */
  firecrawlCreditsUsed: number;
  /** Effective USD per credit (from config) for breakdown display */
  firecrawlEffectiveUsdPerCredit: number;
  /** Alias for byService (e.g. pipeline-data-saver) */
  costByService: Record<string, number>;
  /** Alias for byOperation (e.g. pipeline-data-saver) */
  costByOperation: Record<string, number>;
};

/**
 * Get cost logs with optional filters
 */
export async function getCostLogs(options?: {
  limit?: number;
  offset?: number;
  service?: string;
  runId?: string;
  since?: Date;
}): Promise<CostLogRow[]> {
  if (!pool) return [];

  const { limit = 100, offset = 0, service, runId, since } = options ?? {};
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (service) {
    conditions.push(`service = $${paramIdx++}`);
    params.push(service);
  }
  if (runId) {
    conditions.push(`run_id = $${paramIdx++}`);
    params.push(runId);
  }
  if (since) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(since);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);
  const limitParam = paramIdx;
  const offsetParam = paramIdx + 1;

  const result = await pool.query<CostLogRow>(
    `SELECT * FROM cost_logs ${whereClause} ORDER BY created_at DESC LIMIT $${limitParam} OFFSET $${offsetParam}`,
    params
  );
  return result.rows;
}

/**
 * Get cost logs with breakdown fields for CSV/API (firecrawl_credits_used, openai rates, total_cost_usd).
 */
export async function getCostLogsWithBreakdown(options?: Parameters<typeof getCostLogs>[0]): Promise<CostLogBreakdownRow[]> {
  const rows = await getCostLogs(options);
  return rows.map(toBreakdownRow);
}

/**
 * Get cost summary (totals by service and operation)
 */
export async function getCostSummary(options?: {
  since?: Date;
  runId?: string;
}): Promise<CostSummary> {
  if (!pool) {
    return {
      totalCost: 0,
      byService: {},
      byOperation: {},
      entryCount: 0,
      firecrawlCreditsUsed: 0,
      firecrawlEffectiveUsdPerCredit: 0,
      costByService: {},
      costByOperation: {},
    };
  }

  const { since, runId } = options ?? {};
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIdx = 1;

  if (since) {
    conditions.push(`created_at >= $${paramIdx++}`);
    params.push(since);
  }
  if (runId) {
    conditions.push(`run_id = $${paramIdx++}`);
    params.push(runId);
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await pool.query<{ total_cost: string; count: string }>(
    `SELECT 
      COALESCE(SUM(total_cost), 0)::text as total_cost,
      COUNT(*)::text as count
     FROM cost_logs ${whereClause}`,
    params
  );

  const byServiceResult = await pool.query<{ service: string; sum: string }>(
    `SELECT service, COALESCE(SUM(total_cost), 0)::text as sum 
     FROM cost_logs ${whereClause} GROUP BY service`,
    params
  );

  const byOperationResult = await pool.query<{ operation: string; sum: string }>(
    `SELECT operation, COALESCE(SUM(total_cost), 0)::text as sum 
     FROM cost_logs ${whereClause} GROUP BY operation`,
    params
  );

  let firecrawlCreditsUsed = 0;
  try {
    const firecrawlCreditsCondition = whereClause ? `${whereClause} AND service = 'firecrawl'` : "WHERE service = 'firecrawl'";
    const firecrawlCreditsResult = await pool.query<{ sum: string }>(
      `SELECT COALESCE(SUM(usage_credits), 0)::text as sum FROM cost_logs ${firecrawlCreditsCondition}`,
      params
    );
    firecrawlCreditsUsed = parseInt(firecrawlCreditsResult.rows[0]?.sum ?? '0', 10);
  } catch {
    // usage_credits column may not exist before migration
  }

  const totalCost = parseFloat(result.rows[0]?.total_cost ?? '0');
  const entryCount = parseInt(result.rows[0]?.count ?? '0', 10);
  const byService: Record<string, number> = {};
  const byOperation: Record<string, number> = {};

  for (const row of byServiceResult.rows) {
    byService[row.service] = parseFloat(row.sum);
  }
  for (const row of byOperationResult.rows) {
    byOperation[row.operation] = parseFloat(row.sum);
  }

  return {
    totalCost,
    byService,
    byOperation,
    entryCount,
    firecrawlCreditsUsed,
    firecrawlEffectiveUsdPerCredit: getFirecrawlEffectiveUsdPerCredit(),
    // Aliases for consumers that expect costByService / costByOperation (e.g. pipeline-data-saver)
    costByService: byService,
    costByOperation: byOperation,
  };
}

/**
 * Sum of total_cost for today (server date) for OpenAI and Fireworks.
 * Used when OPENAI_DAILY_BUDGET_USD is set to enforce a daily budget.
 */
export async function getTodaysOpenAIAndFireworksCost(): Promise<number> {
  if (!pool) return 0;
  const result = await pool.query<{ sum: string }>(
    `SELECT COALESCE(SUM(total_cost), 0)::text as sum FROM cost_logs
     WHERE service IN ('openai', 'fireworks') AND created_at >= current_date`
  );
  return parseFloat(result.rows[0]?.sum ?? '0');
}
