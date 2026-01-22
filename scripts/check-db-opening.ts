// Check what's stored in the database for opening and cards
import { pool } from '../src/db/client';
import { getReportCards } from '../src/db/reports';

async function checkDatabase() {
  if (!pool) {
    console.error('❌ Database not configured (DATABASE_URL not set)');
    process.exit(1);
  }

  console.log('🔍 Checking Database Structure...\n');

  // Check latest report
  const reportData = await getReportCards();
  
  if (!reportData) {
    console.log('❌ No reports found in database');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('DATABASE REPORT DATA');
  console.log('='.repeat(60));
  console.log(`Run ID: ${reportData.runId}`);
  console.log(`Published: ${reportData.publishedDate}`);
  console.log(`Total Cards: ${reportData.cards.length}`);
  console.log(`Total Sources: ${reportData.sources.length}\n`);

  // Check opening
  console.log('='.repeat(60));
  console.log('OPENING FIELD (from reports table)');
  console.log('='.repeat(60));
  if (reportData.opening) {
    console.log(`Length: ${reportData.opening.length} characters`);
    console.log(`First 500 chars:\n${reportData.opening.substring(0, 500)}`);
    console.log(`\nHas TLDR: ${/##\s+TLDR/i.test(reportData.opening) ? 'YES ✅' : 'NO ❌'}`);
    
    const tldrMatch = reportData.opening.match(/##\s+TLDR\s*\n(.*?)(?=\n##|$)/is);
    if (tldrMatch) {
      console.log(`\nTLDR Content:\n${tldrMatch[0].substring(0, 300)}`);
    }
  } else {
    console.log('❌ Opening is NULL or empty');
  }

  // Check cards structure
  console.log('\n' + '='.repeat(60));
  console.log('CARDS STRUCTURE (from report_cards table)');
  console.log('='.repeat(60));
  console.log(`Total Cards: ${reportData.cards.length}`);
  
  if (reportData.cards.length > 0) {
    const firstCard = reportData.cards[0];
    console.log(`\nFirst Card:`);
    console.log(`  Title: ${firstCard.title}`);
    console.log(`  Content Length: ${firstCard.content.length} chars`);
    console.log(`  Emoji: ${firstCard.emoji || 'none'}`);
    console.log(`  Ticker: ${firstCard.ticker || 'none'}`);
    console.log(`  Macro: ${firstCard.macro || 'none'}`);
    console.log(`  Card Order: ${firstCard.card_order}`);
    console.log(`\n  ❌ Cards do NOT have an 'opening' field - opening is stored separately in reports table`);
  }

  // Direct database query to see table structure
  console.log('\n' + '='.repeat(60));
  console.log('DATABASE TABLE STRUCTURE');
  console.log('='.repeat(60));
  
  const reportsStructure = await pool.query(`
    SELECT column_name, data_type, character_maximum_length
    FROM information_schema.columns
    WHERE table_name = 'reports'
    ORDER BY ordinal_position
  `);
  
  console.log('\n📊 reports table columns:');
  reportsStructure.rows.forEach(col => {
    console.log(`  - ${col.column_name}: ${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}`);
  });

  const cardsStructure = await pool.query(`
    SELECT column_name, data_type, character_maximum_length
    FROM information_schema.columns
    WHERE table_name = 'report_cards'
    ORDER BY ordinal_position
  `);
  
  console.log('\n📊 report_cards table columns:');
  cardsStructure.rows.forEach(col => {
    console.log(`  - ${col.column_name}: ${col.data_type}${col.character_maximum_length ? `(${col.character_maximum_length})` : ''}`);
  });

  console.log('\n' + '='.repeat(60));
  console.log('SUMMARY');
  console.log('='.repeat(60));
  console.log('✅ Opening is stored in: reports.opening (TEXT field)');
  console.log('❌ Opening is NOT stored in: report_cards table');
  console.log('📝 Cards only contain: title, content, emoji, ticker, macro, card_order');
  console.log('🔗 Opening and Cards are linked by: run_id');
}

checkDatabase()
  .then(() => {
    console.log('\n✅ Check complete');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });
