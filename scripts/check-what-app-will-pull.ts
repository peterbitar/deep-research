import { pool } from '../src/db/client';

async function checkLatest() {
  if (!pool) {
    console.log('No database connection');
    return;
  }
  
  // This is what the API does - getLatestRunId()
  const result = await pool.query(`
    SELECT run_id FROM research_runs ORDER BY created_at DESC LIMIT 1
  `);
  
  const latestRunId = result.rows[0]?.run_id;
  console.log(`📊 Latest run_id (what API will return): ${latestRunId}\n`);
  
  // Get details about this report
  const details = await pool.query(`
    SELECT r.run_id, r.opening, rr.query, rr.status, rr.created_at,
           (SELECT COUNT(*) FROM report_cards WHERE run_id = r.run_id) as card_count
    FROM reports r
    JOIN research_runs rr ON r.run_id = rr.run_id
    WHERE r.run_id = $1
  `, [latestRunId]);
  
  if (details.rows.length > 0) {
    const row = details.rows[0];
    console.log(`📋 Report Details:`);
    console.log(`   Query: ${row.query.substring(0, 80)}...`);
    console.log(`   Status: ${row.status}`);
    console.log(`   Created: ${row.created_at}`);
    console.log(`   Cards: ${row.card_count}`);
    
    // Get card titles
    const cards = await pool.query(`
      SELECT title, ticker, macro
      FROM report_cards
      WHERE run_id = $1
      ORDER BY card_order
      LIMIT 5
    `, [latestRunId]);
    
    console.log(`\n   Card Titles:`);
    cards.rows.forEach((card, i) => {
      console.log(`   ${i+1}. ${card.title}`);
      console.log(`      Ticker: ${card.ticker || 'null'}, Macro: ${card.macro || 'null'}`);
    });
    
    // Count holdings vs macro cards
    const holdingsCount = cards.rows.filter(c => c.ticker).length;
    const macroCount = cards.rows.filter(c => c.macro).length;
    console.log(`\n   Summary:`);
    console.log(`   - Holdings cards (with ticker): ${holdingsCount}`);
    console.log(`   - Macro cards: ${macroCount}`);
  }
  
  process.exit(0);
}

checkLatest().catch(console.error);
