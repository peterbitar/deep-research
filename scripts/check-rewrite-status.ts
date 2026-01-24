import { pool } from '../src/db/client';
import { getReportCards } from '../src/db/reports';

async function checkRewriteStatus() {
  if (!pool) {
    console.log('❌ Database not connected');
    process.exit(1);
  }

  try {
    // Get latest report
    const latest = await getReportCards();
    if (!latest) {
      console.log('⚠️  No report found');
      process.exit(1);
    }

    console.log(`📊 Latest report: ${latest.runId}`);
    console.log(`   Published: ${new Date(latest.publishedDate).toLocaleString()}\n`);

    // Get the full report markdown to check formatting
    const reportResult = await pool.query(
      'SELECT report_markdown, updated_at FROM reports WHERE run_id = $1',
      [latest.runId]
    );

    if (reportResult.rows.length === 0) {
      console.log('⚠️  Report not found in reports table');
      process.exit(1);
    }

    const report = reportResult.rows[0];
    const updatedAt = new Date(report.updated_at);
    const createdAt = new Date(latest.publishedDate);
    const timeDiff = (updatedAt.getTime() - createdAt.getTime()) / 1000; // seconds

    console.log(`   Created: ${createdAt.toLocaleString()}`);
    console.log(`   Updated: ${updatedAt.toLocaleString()}`);
    
    if (timeDiff > 10) {
      console.log(`   ⏱️  Time difference: ${Math.round(timeDiff)}s (likely rewritten)`);
    } else {
      console.log(`   ⏱️  Time difference: ${Math.round(timeDiff)}s (not rewritten yet)`);
    }

    // Check if content has proper paragraph breaks (indicator of rewrite)
    const reportMarkdown = report.report_markdown;
    const hasParagraphBreaks = /\n\n[A-Z]/.test(reportMarkdown);
    const paragraphCount = (reportMarkdown.match(/\n\n/g) || []).length;

    console.log(`\n   Formatting check:`);
    console.log(`   - Has paragraph breaks: ${hasParagraphBreaks ? '✅' : '❌'}`);
    console.log(`   - Paragraph breaks count: ${paragraphCount}`);

    // Check card titles format
    console.log(`\n   Card titles:`);
    latest.cards.forEach((card, i) => {
      const wordCount = card.title.split(/\s+/).length;
      const isMessageStyle = wordCount >= 9 && wordCount <= 14;
      console.log(`   ${i + 1}. "${card.title}" (${wordCount} words) ${isMessageStyle ? '✅' : '⚠️'}`);
    });

    // Show full card content for inspection
    console.log(`\n   === FULL CARD CONTENT ===`);
    latest.cards.forEach((card, i) => {
      console.log(`\n   Card ${i + 1}: "${card.title}"`);
      console.log(`   Content (${card.content.length} chars):`);
      console.log(`   ${'─'.repeat(60)}`);
      console.log(card.content);
      console.log(`   ${'─'.repeat(60)}`);
    });

    process.exit(0);
  } catch (error) {
    console.error('❌ Error checking rewrite status:', error);
    process.exit(1);
  }
}

checkRewriteStatus();
