/**
 * Check status of research runs
 */
import { pool } from '../src/db/client';

async function main() {
  if (!pool) {
    throw new Error('Database not configured');
  }

  const result = await pool.query(
    `SELECT run_id, status, created_at 
     FROM research_runs 
     WHERE status = 'researching' 
     ORDER BY created_at DESC 
     LIMIT 5`
  );

  console.log('=== Latest Research Runs ===\n');
  if (result.rows.length === 0) {
    console.log('❌ No research runs found (script may have timed out before saving)\n');
  } else {
    for (const row of result.rows) {
      const learningsResult = await pool.query(
        'SELECT COUNT(*) as count FROM research_learnings WHERE run_id = $1',
        [row.run_id]
      );
      const learningsCount = parseInt(learningsResult.rows[0]?.count || '0', 10);

      const urlsResult = await pool.query(
        'SELECT COUNT(*) as count FROM report_sources WHERE run_id = $1',
        [row.run_id]
      );
      const urlsCount = parseInt(urlsResult.rows[0]?.count || '0', 10);

      console.log(`Run ID: ${row.run_id}`);
      console.log(`  Status: ${row.status}`);
      console.log(`  Created: ${new Date(row.created_at).toLocaleString()}`);
      console.log(`  Learnings: ${learningsCount}`);
      console.log(`  URLs: ${urlsCount}`);
      console.log('');
    }
  }

  process.exit(0);
}

main().catch(console.error);
