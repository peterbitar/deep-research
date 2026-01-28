// Check if holdings are saved in the database for recent runs

import { pool } from '../src/db/client';

async function main() {
  if (!pool) {
    console.error('❌ Database not configured');
    process.exit(1);
  }

  try {
    // Get recent research runs
    const result = await pool.query(
      `SELECT run_id, query, created_at 
       FROM research_runs 
       ORDER BY created_at DESC 
       LIMIT 5`
    );

    console.log('📊 Recent Research Runs:\n');
    
    for (const row of result.rows) {
      console.log(`Run ID: ${row.run_id}`);
      console.log(`Created: ${row.created_at}`);
      console.log(`Query: ${row.query.substring(0, 200)}${row.query.length > 200 ? '...' : ''}`);
      
      // Check for holdings
      const holdingsMatch = row.query.match(/HOLDINGS:\s*([A-Z0-9,]+)/i);
      if (holdingsMatch) {
        const holdings = holdingsMatch[1].split(',').map(s => s.trim());
        console.log(`✅ Holdings found: ${holdings.join(', ')}`);
        console.log(`   Total: ${holdings.length} holdings`);
        
        const hasBB = holdings.includes('BB');
        const hasLSPD = holdings.includes('LSPD');
        console.log(`   BB: ${hasBB ? '✅' : '❌'}`);
        console.log(`   LSPD: ${hasLSPD ? '✅' : '❌'}`);
      } else {
        console.log('❌ No holdings found in query');
      }
      console.log('');
    }

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
