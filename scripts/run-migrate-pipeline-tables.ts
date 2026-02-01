/**
 * Run pipeline tables migration (creates pipeline_iterations, pipeline_gathered, etc.)
 * Usage: npx tsx --env-file=.env.local scripts/run-migrate-pipeline-tables.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { pool } from '../src/db/client';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required. Use --env-file=.env.local or set DATABASE_URL.');
    process.exit(1);
  }
  if (!pool) {
    console.error('Database pool not initialized.');
    process.exit(1);
  }

  const sqlPath = path.join(__dirname, 'migrate-pipeline-tables.sql');
  const sql = await fs.readFile(sqlPath, 'utf-8');

  console.log('Running pipeline tables migration...');
  await pool.query(sql);
  console.log('Done. Tables created: pipeline_iterations, pipeline_gathered, pipeline_triaged, pipeline_filter, pipeline_scraped');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
