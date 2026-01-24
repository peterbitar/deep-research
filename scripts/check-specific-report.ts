import { pool } from '../src/db/client';

async function checkReport() {
  if (!pool) {
    console.log('No database connection');
    return;
  }
  
  const runId = process.argv[2] || 'research-1769186691681';
  
  // Check if report exists
  const reportResult = await pool.query(`
    SELECT r.run_id, r.opening, rr.query, rr.status, rr.created_at
    FROM reports r
    JOIN research_runs rr ON r.run_id = rr.run_id
    WHERE r.run_id = $1
  `, [runId]);
  
  if (reportResult.rows.length === 0) {
    console.log(`❌ Report ${runId} NOT FOUND in reports table`);
    
    // Check if it exists in research_runs
    const runResult = await pool.query(`
      SELECT run_id, query, status, created_at
      FROM research_runs
      WHERE run_id = $1
    `, [runId]);
    
    if (runResult.rows.length > 0) {
      console.log(`⚠️  But it EXISTS in research_runs with status: ${runResult.rows[0].status}`);
    }
  } else {
    console.log(`✅ Report ${runId} FOUND:`);
    console.log(`   Query: ${reportResult.rows[0].query}`);
    console.log(`   Status: ${reportResult.rows[0].status}`);
    console.log(`   Created: ${reportResult.rows[0].created_at}`);
    console.log(`   Opening: ${reportResult.rows[0].opening.substring(0, 100)}...`);
    
    // Check cards
    const cardsResult = await pool.query(`
      SELECT title, ticker, macro
      FROM report_cards
      WHERE run_id = $1
      ORDER BY card_order
    `, [runId]);
    
    console.log(`\n   Cards (${cardsResult.rows.length}):`);
    cardsResult.rows.forEach((card, i) => {
      console.log(`   ${i+1}. ${card.title}`);
      console.log(`      Ticker: ${card.ticker || 'null'}, Macro: ${card.macro || 'null'}`);
    });
  }
  
  process.exit(0);
}

checkReport().catch(console.error);
