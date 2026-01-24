import { pool } from '../src/db/client';

async function checkFormat() {
  if (!pool) {
    console.log('No database connection');
    return;
  }
  
  const runId = 'research-1769186691681';
  
  const result = await pool.query(`
    SELECT title, content
    FROM report_cards
    WHERE run_id = $1
    ORDER BY card_order
    LIMIT 1
  `, [runId]);
  
  if (result.rows.length > 0) {
    const content = result.rows[0].content;
    const title = result.rows[0].title;
    
    console.log(`Card Title: ${title}\n`);
    console.log('First 600 characters of card content:');
    console.log('---');
    console.log(content.substring(0, 600));
    console.log('---\n');
    
    // Check if it has the dash format
    const hasDashFormat = content.includes('**') && content.includes(' - ');
    const hasOldFormat = content.includes('**') && / \*\*[^*]+\*\*  [^-]/.test(content);
    
    if (hasDashFormat) {
      console.log('✅ Format is correct: Headlines have " - " (space dash space) after them');
    } else if (hasOldFormat) {
      console.log('⚠️  Format may still be old: Headlines have two spaces instead of dash');
    } else {
      console.log('⚠️  Format check inconclusive');
    }
  }
  
  process.exit(0);
}

checkFormat().catch(console.error);
