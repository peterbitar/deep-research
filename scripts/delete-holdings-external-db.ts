/**
 * Delete holdings from external API database
 * 
 * This requires the external API's DATABASE_URL.
 * Set EXTERNAL_API_DATABASE_URL in .env.local to point to the external API database.
 * 
 * Usage:
 *   npx tsx --env-file=.env.local scripts/delete-holdings-external-db.ts
 */

import pg from 'pg';
const { Pool } = pg;

async function main() {
  console.log('🗑️  Delete Holdings from External API Database\n');

  // Try to get external database URL
  const externalDbUrl = process.env.EXTERNAL_API_DATABASE_URL || process.env.DATABASE_URL;
  
  if (!externalDbUrl) {
    throw new Error('EXTERNAL_API_DATABASE_URL or DATABASE_URL is required');
  }

  console.log('Connecting to external database...');
  const externalPool = new Pool({
    connectionString: externalDbUrl,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  });

  try {
    // Test connection
    await externalPool.query('SELECT NOW()');
    console.log('✅ Connected to external database\n');

    // Try different possible table names
    const possibleTables = ['holding', 'holdings'];
    let foundTable: string | null = null;

    for (const tableName of possibleTables) {
      try {
        const result = await externalPool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
        const count = parseInt(result.rows[0]?.count || '0', 10);
        if (count > 0) {
          foundTable = tableName;
          console.log(`✅ Found table: ${tableName}`);
          console.log(`   Holdings count: ${count}\n`);

          // Show what we're deleting
          const userHoldingsResult = await externalPool.query(
            `SELECT user_id, symbol 
             FROM ${tableName} 
             ORDER BY user_id`
          );

          const userMap = new Map<string, string[]>();
          userHoldingsResult.rows.forEach((row: any) => {
            const userId = row.user_id;
            const symbol = row.symbol;
            if (!userMap.has(userId)) {
              userMap.set(userId, []);
            }
            userMap.get(userId)!.push(symbol);
          });

          console.log('📊 Holdings to delete:');
          userMap.forEach((symbols, userId) => {
            console.log(`   User ${userId}: ${symbols.length} holdings (${symbols.join(', ')})`);
          });

          // Delete all holdings
          console.log(`\n🗑️  Deleting all holdings from ${tableName}...`);
          await externalPool.query(`DELETE FROM ${tableName}`);
          console.log(`✅ Deleted all holdings!`);
          console.log(`   The research script will now only run macro research.\n`);
          break;
        }
      } catch (e: any) {
        if (e.code !== '42P01') {
          console.log(`   ⚠️  Error checking ${tableName}: ${e.message}`);
        }
      }
    }

    if (!foundTable) {
      console.log('❌ Holdings table not found in external database');
      console.log('   Holdings may be in a different database or already deleted.\n');
    }
  } finally {
    await externalPool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
