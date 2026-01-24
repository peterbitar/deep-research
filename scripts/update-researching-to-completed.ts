import { pool } from '../src/db/client';

async function updateResearching() {
  if (!pool) {
    console.log('No database connection');
    return;
  }
  
  // Get all reports with status "researching"
  const researchingResult = await pool.query(`
    SELECT run_id, query, status, created_at
    FROM research_runs
    WHERE status = 'researching'
    ORDER BY created_at DESC
  `);
  
  if (researchingResult.rows.length === 0) {
    console.log('No reports with status "researching" found');
    return;
  }
  
  console.log(`Found ${researchingResult.rows.length} report(s) with status "researching":\n`);
  
  for (const row of researchingResult.rows) {
    console.log(`📊 ${row.run_id}`);
    console.log(`   Query: ${row.query.substring(0, 80)}...`);
    console.log(`   Created: ${row.created_at}`);
    
    // Update status to completed
    await pool.query(`
      UPDATE research_runs
      SET status = 'completed', updated_at = CURRENT_TIMESTAMP
      WHERE run_id = $1
    `, [row.run_id]);
    
    console.log(`   ✅ Updated to 'completed'\n`);
  }
  
  console.log(`✅ All "researching" reports updated to "completed"`);
  
  process.exit(0);
}

updateResearching().catch(console.error);
