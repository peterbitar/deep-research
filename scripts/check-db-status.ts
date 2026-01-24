import { pool } from '../src/db/client';
import { getReportCards } from '../src/db/reports';

async function checkStatus() {
  if (!pool) {
    console.log('❌ Database not connected');
    process.exit(1);
  }

  try {
    const result = await pool.query(
      'SELECT run_id, query, created_at FROM research_runs ORDER BY created_at DESC LIMIT 5'
    );

    console.log('📊 Latest research runs:\n');
    result.rows.forEach((row, i) => {
      const time = new Date(row.created_at).toLocaleString();
      console.log(`  ${i + 1}. ${row.run_id}`);
      console.log(`     Time: ${time}`);
      console.log(`     Query: ${row.query.substring(0, 70)}...\n`);
    });

    const latest = await getReportCards();
    if (latest) {
      console.log(`✅ Latest report: ${latest.runId}`);
      console.log(`   Cards: ${latest.cards.length}`);
      console.log(`   Published: ${new Date(latest.publishedDate).toLocaleString()}`);
      console.log(`   Opening: ${latest.opening.substring(0, 100)}...`);
      if (latest.cards.length > 0) {
        console.log(`\n   First card title: "${latest.cards[0].title}"`);
      }
    } else {
      console.log('\n⚠️  No report cards found in database');
    }

    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking status:', error);
    process.exit(1);
  }
}

checkStatus();
