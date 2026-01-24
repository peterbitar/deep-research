/**
 * Delete holdings from external API database
 * 
 * This script deletes holdings from the external API database so that
 * the research script will only run macro research.
 * 
 * Requires: Access to the external API database (same DATABASE_URL or separate)
 * 
 * Usage:
 *   npx tsx --env-file=.env.local scripts/delete-holdings-from-api-db.ts
 */

import { pool } from '../src/db/client';

async function main() {
  console.log('🗑️  Delete Holdings from Database\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required');
  }
  if (!pool) {
    throw new Error('Database pool not initialized');
  }

  // Try different possible table names and schemas
  const possibleTables = [
    'holding',
    'holdings',
    'public.holding',
    'public.holdings',
  ];

  let foundTable: string | null = null;
  let holdingsCount = 0;

  for (const tableName of possibleTables) {
    try {
      const result = await pool.query(`SELECT COUNT(*) as count FROM ${tableName}`);
      const count = parseInt(result.rows[0]?.count || '0', 10);
      if (count > 0) {
        foundTable = tableName;
        holdingsCount = count;
        console.log(`✅ Found table: ${tableName}`);
        console.log(`   Holdings count: ${count}`);
        break;
      }
    } catch (e: any) {
      // Table doesn't exist or other error - continue
      if (e.code !== '42P01') {
        // Not a "table doesn't exist" error
        console.log(`   ⚠️  Error checking ${tableName}: ${e.message}`);
      }
    }
  }

  if (!foundTable) {
    console.log('❌ Holdings table not found in this database');
    console.log('\nHoldings are stored in the external API database.');
    console.log('To delete holdings, you need to:');
    console.log('1. Access the external API database directly');
    console.log('2. Run: DELETE FROM holding; (or DELETE FROM holdings;)');
    console.log('3. Or use the external API admin interface if available\n');
    process.exit(0);
  }

  // Show what we're deleting
  try {
    const userHoldingsResult = await pool.query(
      `SELECT user_id, symbol, COUNT(*) as count 
       FROM ${foundTable} 
       GROUP BY user_id, symbol 
       ORDER BY user_id`
    );

    console.log('\n📊 Holdings to delete:');
    const userMap = new Map<string, string[]>();
    userHoldingsResult.rows.forEach((row: any) => {
      const userId = row.user_id;
      const symbol = row.symbol;
      if (!userMap.has(userId)) {
        userMap.set(userId, []);
      }
      userMap.get(userId)!.push(symbol);
    });

    userMap.forEach((symbols, userId) => {
      console.log(`   User ${userId}: ${symbols.length} holdings (${symbols.join(', ')})`);
    });
  } catch (e) {
    console.log('   (Could not list holdings by user)');
  }

  // Delete all holdings
  console.log(`\n🗑️  Deleting all holdings from ${foundTable}...`);
  const deleteResult = await pool.query(`DELETE FROM ${foundTable}`);
  console.log(`✅ Deleted all holdings!`);
  console.log(`   The research script will now only run macro research.\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
