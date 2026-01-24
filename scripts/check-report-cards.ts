import { pool } from '../src/db/client';

async function checkCards() {
  if (!pool) {
    console.log('No database connection');
    return;
  }
  
  const netflixRunId = 'research-1769186691681';
  const macroRunId = 'research-1769187875703';
  
  console.log('📊 Netflix Report Cards:');
  const netflixCards = await pool.query(`
    SELECT title, ticker, macro, card_order
    FROM report_cards
    WHERE run_id = $1
    ORDER BY card_order
  `, [netflixRunId]);
  
  console.log(`   Found ${netflixCards.rows.length} cards:`);
  netflixCards.rows.forEach((card, i) => {
    console.log(`   ${i+1}. ${card.title}`);
    console.log(`      Ticker: ${card.ticker || 'null'}, Macro: ${card.macro || 'null'}`);
  });
  
  console.log('\n📊 Macro Report Cards:');
  const macroCards = await pool.query(`
    SELECT title, ticker, macro, card_order
    FROM report_cards
    WHERE run_id = $1
    ORDER BY card_order
  `, [macroRunId]);
  
  console.log(`   Found ${macroCards.rows.length} cards:`);
  macroCards.rows.forEach((card, i) => {
    console.log(`   ${i+1}. ${card.title}`);
    console.log(`      Ticker: ${card.ticker || 'null'}, Macro: ${card.macro || 'null'}`);
  });
  
  console.log('\n🔍 Latest run_id from research_runs:');
  const latest = await pool.query(`
    SELECT run_id, created_at
    FROM research_runs
    ORDER BY created_at DESC
    LIMIT 1
  `);
  console.log(`   ${latest.rows[0].run_id} (created at ${latest.rows[0].created_at})`);
  console.log(`   This is what the API will return!`);
  
  process.exit(0);
}

checkCards().catch(console.error);
