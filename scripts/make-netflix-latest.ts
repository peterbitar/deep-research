import { pool } from '../src/db/client';

async function makeNetflixLatest() {
  if (!pool) {
    console.log('No database connection');
    return;
  }
  
  const netflixRunId = 'research-1769186691681';
  const macroRunId = 'research-1769187875703';
  
  // Get current timestamps
  const netflixResult = await pool.query(`
    SELECT created_at FROM research_runs WHERE run_id = $1
  `, [netflixRunId]);
  
  const macroResult = await pool.query(`
    SELECT created_at FROM research_runs WHERE run_id = $1
  `, [macroRunId]);
  
  if (netflixResult.rows.length === 0) {
    console.log('❌ Netflix report not found');
    return;
  }
  
  if (macroResult.rows.length === 0) {
    console.log('❌ Macro report not found');
    return;
  }
  
  const netflixCreated = new Date(netflixResult.rows[0].created_at);
  const macroCreated = new Date(macroResult.rows[0].created_at);
  
  console.log(`📊 Current timestamps:`);
  console.log(`   Netflix: ${netflixCreated.toISOString()}`);
  console.log(`   Macro:   ${macroCreated.toISOString()}`);
  
  // Make macro report older (1 hour before Netflix)
  const newMacroTimestamp = new Date(netflixCreated.getTime() - 60 * 60 * 1000);
  
  console.log(`\n🔄 Updating macro report timestamp to: ${newMacroTimestamp.toISOString()}`);
  
  await pool.query(`
    UPDATE research_runs
    SET created_at = $1, updated_at = CURRENT_TIMESTAMP
    WHERE run_id = $2
  `, [newMacroTimestamp, macroRunId]);
  
  // Verify
  const latestResult = await pool.query(`
    SELECT run_id, created_at
    FROM research_runs
    ORDER BY created_at DESC
    LIMIT 1
  `);
  
  console.log(`\n✅ Latest report is now: ${latestResult.rows[0].run_id}`);
  console.log(`   Created at: ${latestResult.rows[0].created_at}`);
  
  if (latestResult.rows[0].run_id === netflixRunId) {
    console.log(`\n🎉 Success! Netflix report is now the latest.`);
  } else {
    console.log(`\n⚠️  Warning: Netflix report is still not the latest.`);
  }
  
  process.exit(0);
}

makeNetflixLatest().catch(console.error);
