import { pool } from '../src/db/client';

async function fixReport() {
  if (!pool) {
    console.log('No database connection');
    return;
  }
  
  const runId = 'research-1769186691681';
  
  // Update status to completed
  await pool.query(`
    UPDATE research_runs
    SET status = 'completed', updated_at = CURRENT_TIMESTAMP
    WHERE run_id = $1
  `, [runId]);
  
  console.log(`✅ Updated report ${runId} status to 'completed'`);
  
  // Check what the latest report is now
  const latestResult = await pool.query(`
    SELECT run_id, query, status, created_at
    FROM research_runs
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  console.log(`\n📊 Latest report is now:`);
  console.log(`   Run ID: ${latestResult.rows[0].run_id}`);
  console.log(`   Status: ${latestResult.rows[0].status}`);
  console.log(`   Created: ${latestResult.rows[0].created_at}`);
  
  console.log(`\n⚠️  Note: The macro report (research-1769187875703) is still newer.`);
  console.log(`   The API will return the latest by created_at, which is the macro report.`);
  console.log(`   To get the Netflix report, you'd need to either:`);
  console.log(`   1. Delete the macro report, or`);
  console.log(`   2. Modify the API to accept a runId parameter`);
  
  process.exit(0);
}

fixReport().catch(console.error);
