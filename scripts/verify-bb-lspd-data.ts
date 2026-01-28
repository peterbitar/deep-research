// Verify that BB and LSPD data exists in the database for run research-1769561604291

import { pool } from '../src/db/client';

const runId = 'research-1769561604291';

async function verifyData() {
  if (!pool) {
    console.error('❌ Database not configured');
    process.exit(1);
  }

  console.log(`🔍 Verifying data for run: ${runId}\n`);

  try {
    // 1. Check research_learnings table for BB and LSPD
    console.log('1️⃣  Checking research_learnings table...');
    const learningsQuery = `
      SELECT learning, learning_order, source_url
      FROM research_learnings
      WHERE run_id = $1
        AND (UPPER(learning) LIKE '%BB%' OR UPPER(learning) LIKE '%BLACKBERRY%' 
             OR UPPER(learning) LIKE '%LSPD%' OR UPPER(learning) LIKE '%LIGHTSPEED%')
      ORDER BY learning_order
    `;
    
    const learningsResult = await pool.query(learningsQuery, [runId]);
    console.log(`   Found ${learningsResult.rows.length} learnings mentioning BB or LSPD`);
    
    if (learningsResult.rows.length > 0) {
      console.log('\n   Sample learnings:');
      learningsResult.rows.slice(0, 5).forEach((row, i) => {
        const preview = row.learning.substring(0, 100) + (row.learning.length > 100 ? '...' : '');
        console.log(`   ${i + 1}. [${row.learning_order}] ${preview}`);
      });
    }

    // 2. Check report_cards table for BB and LSPD cards
    console.log('\n2️⃣  Checking report_cards table...');
    const cardsQuery = `
      SELECT title, content, ticker, macro, card_order
      FROM report_cards
      WHERE run_id = $1
        AND (ticker IN ('BB', 'LSPD') 
             OR UPPER(title) LIKE '%BB%' OR UPPER(title) LIKE '%BLACKBERRY%'
             OR UPPER(title) LIKE '%LSPD%' OR UPPER(title) LIKE '%LIGHTSPEED%'
             OR UPPER(content) LIKE '%BB%' OR UPPER(content) LIKE '%BLACKBERRY%'
             OR UPPER(content) LIKE '%LSPD%' OR UPPER(content) LIKE '%LIGHTSPEED%')
      ORDER BY card_order
    `;
    
    const cardsResult = await pool.query(cardsQuery, [runId]);
    console.log(`   Found ${cardsResult.rows.length} cards mentioning BB or LSPD`);
    
    if (cardsResult.rows.length > 0) {
      console.log('\n   Cards found:');
      cardsResult.rows.forEach((row, i) => {
        console.log(`   ${i + 1}. [Card ${row.card_order}] Ticker: ${row.ticker || 'none'}`);
        console.log(`      Title: ${row.title}`);
        console.log(`      Content preview: ${row.content.substring(0, 150)}...`);
        console.log('');
      });
    } else {
      console.log('   ⚠️  No cards found for BB or LSPD');
    }

    // 3. Check all cards to see what tickers are represented
    console.log('3️⃣  Checking all cards and their tickers...');
    const allCardsQuery = `
      SELECT ticker, COUNT(*) as count
      FROM report_cards
      WHERE run_id = $1
      GROUP BY ticker
      ORDER BY count DESC
    `;
    
    const allCardsResult = await pool.query(allCardsQuery, [runId]);
    console.log(`   Total cards by ticker:`);
    allCardsResult.rows.forEach(row => {
      console.log(`   - ${row.ticker || '(no ticker)'}: ${row.count} card(s)`);
    });

    // 4. Check total learnings count
    console.log('\n4️⃣  Checking total learnings count...');
    const totalLearningsQuery = `
      SELECT COUNT(*) as total
      FROM research_learnings
      WHERE run_id = $1
    `;
    
    const totalLearningsResult = await pool.query(totalLearningsQuery, [runId]);
    console.log(`   Total learnings: ${totalLearningsResult.rows[0].total}`);

    // 5. Check report_sources for BB/LSPD related URLs
    console.log('\n5️⃣  Checking report_sources for BB/LSPD related URLs...');
    const sourcesQuery = `
      SELECT source_url, source_order
      FROM report_sources
      WHERE run_id = $1
        AND (UPPER(source_url) LIKE '%BLACKBERRY%' 
             OR UPPER(source_url) LIKE '%LIGHTSPEED%'
             OR UPPER(source_url) LIKE '%BB%'
             OR UPPER(source_url) LIKE '%LSPD%')
      ORDER BY source_order
      LIMIT 10
    `;
    
    const sourcesResult = await pool.query(sourcesQuery, [runId]);
    console.log(`   Found ${sourcesResult.rows.length} source URLs mentioning BB or LSPD`);
    
    if (sourcesResult.rows.length > 0) {
      console.log('\n   Sample URLs:');
      sourcesResult.rows.forEach((row, i) => {
        console.log(`   ${i + 1}. ${row.source_url}`);
      });
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Run ID: ${runId}`);
    console.log(`Total learnings: ${totalLearningsResult.rows[0].total}`);
    console.log(`BB/LSPD learnings: ${learningsResult.rows.length}`);
    console.log(`BB/LSPD cards: ${cardsResult.rows.length}`);
    console.log(`BB/LSPD source URLs: ${sourcesResult.rows.length}`);
    
    if (cardsResult.rows.length === 0) {
      console.log('\n⚠️  WARNING: No cards found for BB or LSPD!');
      console.log('   This means the cards were not generated or selected for the final report.');
      console.log('   The learnings exist, but cards may not have been created.');
    } else {
      console.log('\n✅ BB and LSPD data exists in the database!');
    }

  } catch (error) {
    console.error('❌ Error verifying data:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

verifyData();
