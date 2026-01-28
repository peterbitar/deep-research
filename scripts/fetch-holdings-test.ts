/**
 * Quick script to fetch and display holdings from the API
 */

import { fetchUserHoldings } from '../src/fetch-holdings';

const DEFAULT_HOLDINGS_API = 'https://wealthyrabbitios-production-03a4.up.railway.app';

async function main() {
  const baseURL = process.env.MAIN_BACKEND_URL || 
                  process.env.HOLDINGS_API_BASE_URL || 
                  DEFAULT_HOLDINGS_API;

  console.log('📡 Fetching users from:', baseURL);
  console.log('');

  // First get users
  const usersRes = await fetch(`${baseURL}/api/users`, {
    method: 'GET',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  });

  if (!usersRes.ok) {
    throw new Error(`Failed to fetch users: ${usersRes.status} ${usersRes.statusText}`);
  }

  const users = await usersRes.json() as Array<{ user_id?: string; userId?: string }>;
  console.log(`✅ Found ${users.length} user(s)`);
  console.log('Users:', JSON.stringify(users, null, 2));
  console.log('');

  // Fetch holdings for each user
  const allHoldings: Array<{ symbol: string; type: string; name: string }> = [];
  
  for (const user of users) {
    const uid = user.user_id || user.userId;
    if (!uid) {
      console.log(`⚠️  Skipping user with no ID:`, user);
      continue;
    }
    
    console.log(`📦 Fetching holdings for user: ${uid}`);
    try {
      const holdings = await fetchUserHoldings({
        userId: uid,
        baseURL,
        healthCheck: false,
      });
      console.log(`   ✅ ${holdings.length} holdings:`);
      holdings.forEach(h => {
        console.log(`      - ${h.symbol} (${h.type}): ${h.name || h.symbol}`);
      });
      allHoldings.push(...holdings);
    } catch (e) {
      console.error(`   ❌ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
    console.log('');
  }

  // Deduplicate
  const seen = new Set<string>();
  const uniqueHoldings = allHoldings.filter((h) => {
    const s = h.symbol.toUpperCase().trim();
    if (seen.has(s)) return false;
    seen.add(s);
    return true;
  });

  console.log('='.repeat(60));
  console.log(`📊 Summary: ${uniqueHoldings.length} unique holdings across all users`);
  console.log('='.repeat(60));
  uniqueHoldings.forEach(h => {
    console.log(`  ${h.symbol.padEnd(8)} | ${h.type.padEnd(15)} | ${h.name || h.symbol}`);
  });
}

main().catch((e) => {
  console.error('Error:', e);
  process.exit(1);
});
