import { pool } from '../src/db/client';

async function checkReports() {
  if (!pool) {
    console.log('No database connection');
    return;
  }
  
  const result = await pool.query(`
    SELECT run_id, query, created_at, status
    FROM research_runs
    ORDER BY created_at DESC
    LIMIT 5
  `);
  
  console.log('Recent reports:');
  result.rows.forEach((row, i) => {
    console.log(`${i+1}. Run ID: ${row.run_id}`);
    console.log(`   Query: ${row.query.substring(0, 100)}...`);
    console.log(`   Created: ${row.created_at}`);
    console.log(`   Status: ${row.status}`);
    console.log('');
  });
  
  process.exit(0);
}

checkReports().catch(console.error);
