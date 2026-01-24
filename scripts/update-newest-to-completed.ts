import { pool } from '../src/db/client';

async function updateNewest() {
  if (!pool) {
    console.log('No database connection');
    return;
  }
  
  // Get the newest report
  const latestResult = await pool.query(`
    SELECT run_id, query, status, created_at
    FROM research_runs
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  if (latestResult.rows.length === 0) {
    console.log('No reports found');
    return;
  }
  
  const newestRunId = latestResult.rows[0].run_id;
  const currentStatus = latestResult.rows[0].status;
  
  console.log(`📊 Newest report: ${newestRunId}`);
  console.log(`   Current status: ${currentStatus}`);
  console.log(`   Created: ${latestResult.rows[0].created_at}`);
  
  // Update status to completed
  await pool.query(`
    UPDATE research_runs
    SET status = 'completed', updated_at = CURRENT_TIMESTAMP
    WHERE run_id = $1
  `, [newestRunId]);
  
  console.log(`\n✅ Updated status to 'completed'`);
  
  // Verify the update
  const verifyResult = await pool.query(`
    SELECT run_id, status, updated_at
    FROM research_runs
    WHERE run_id = $1
  `, [newestRunId]);
  
  console.log(`\n✅ Verified: Status is now '${verifyResult.rows[0].status}'`);
  console.log(`   Updated at: ${verifyResult.rows[0].updated_at}`);
  
  process.exit(0);
}

updateNewest().catch(console.error);
