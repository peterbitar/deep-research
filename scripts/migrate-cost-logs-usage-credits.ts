/**
 * Migration: add usage_credits to cost_logs for Firecrawl credit-based costing.
 * Run: npx tsx scripts/migrate-cost-logs-usage-credits.ts
 */
import { pool } from '../src/db/client';

async function migrate() {
  if (!pool) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  try {
    const r = await pool.query(`
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'cost_logs' AND column_name = 'usage_credits'
    `);
    if (r.rows.length > 0) {
      console.log('Column cost_logs.usage_credits already exists.');
      process.exit(0);
    }
    await pool.query('ALTER TABLE cost_logs ADD COLUMN usage_credits INTEGER');
    console.log('Added cost_logs.usage_credits.');
  } catch (e) {
    console.error('Migration failed:', e);
    process.exit(1);
  } finally {
    await pool?.end();
  }
}

migrate();
