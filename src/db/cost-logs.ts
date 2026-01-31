/**
 * Database functions for cost logs
 */

import { pool } from './client';

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
  run_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
};

export type CostSummary = {
  totalCost: number;
  byService: Record<string, number>;
  byOperation: Record<string, number>;
  entryCount: number;
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
 * Get cost summary (totals by service and operation)
 */
export async function getCostSummary(options?: {
  since?: Date;
  runId?: string;
}): Promise<CostSummary> {
  if (!pool) {
    return { totalCost: 0, byService: {}, byOperation: {}, entryCount: 0 };
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

  const result = await pool.query<{ total_cost: string; service: string; operation: string; count: string }>(
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
  };
}
