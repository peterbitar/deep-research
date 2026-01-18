// Test script to fetch users and holdings from API (no deep research - just connection test)
// Usage: tsx scripts/test-fetch-holdings.ts [baseURL]

const baseURL = process.argv[2] || process.env.HOLDINGS_API_BASE_URL || 'http://localhost:3001';

async function testFetchHoldings() {
  console.log('🔍 Testing Holdings API Connection\n');
  console.log(`📍 Base URL: ${baseURL}\n`);

  try {
    // Step 1: Check health
    console.log('1️⃣  Checking API health...');
    const healthResponse = await fetch(`${baseURL}/health`);
    if (!healthResponse.ok) {
      throw new Error(`Health check failed: ${healthResponse.status} ${healthResponse.statusText}`);
    }
    const health = await healthResponse.json();
    console.log(`   ✅ Health: ${JSON.stringify(health)}\n`);

    // Step 2: Get list of users from /api/users endpoint
    console.log('2️⃣  Fetching user list from /api/users...');
    let users: string[] = [];
    
    try {
      const response = await fetch(`${baseURL}/api/users`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
      });
      
      if (!response.ok) {
        throw new Error(`Failed to fetch users: ${response.status} ${response.statusText}`);
      }
      
      const data = await response.json();
      
      // Handle different response formats
      // Extract user_id (string identifier), not numeric id
      if (Array.isArray(data)) {
        users = data.map((u: any) => {
          if (typeof u === 'string') return u;
          // Prefer user_id (string) over id (number) - API uses user_id for holdings endpoint
          return u.user_id || u.userId || (typeof u.id === 'string' ? u.id : null) || String(u.id || u._id);
        }).filter(Boolean);
      } else if (data.users && Array.isArray(data.users)) {
        users = data.users.map((u: any) => {
          if (typeof u === 'string') return u;
          // Prefer user_id (string) over id (number) - API uses user_id for holdings endpoint
          return u.user_id || u.userId || (typeof u.id === 'string' ? u.id : null) || String(u.id || u._id);
        }).filter(Boolean);
      } else if (data.userIds && Array.isArray(data.userIds)) {
        users = data.userIds;
      }
      
      if (users.length > 0) {
        console.log(`   ✅ Found ${users.length} user(s): ${users.join(', ')}\n`);
      } else {
        console.log(`   ⚠️  Endpoint responded but no users found in response`);
        console.log(`   📋 Response: ${JSON.stringify(data).substring(0, 200)}\n`);
      }
    } catch (error) {
      console.log(`   ❌ Error fetching users: ${error instanceof Error ? error.message : String(error)}`);
      console.log(`   ⚠️  Falling back to default user IDs...\n`);
    }

    if (users.length === 0) {
      console.log('   ⚠️  No users found, trying default user IDs...');
      // Try common user IDs
      users = ['1', '2', 'test', 'demo'];
      console.log(`   Trying: ${users.join(', ')}\n`);
    }

    // Step 3: Try to get holdings for first available user
    console.log('3️⃣  Fetching holdings for users...\n');
    let foundHoldings = false;

    for (const userId of users) {
      try {
        console.log(`   Testing user: ${userId}`);
        const response = await fetch(`${baseURL}/api/holdings/${userId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        if (!response.ok) {
          console.log(`      ❌ Status: ${response.status} ${response.statusText}`);
          continue;
        }

        const holdings = await response.json();
        console.log(`      ✅ Status: ${response.status} OK`);
        console.log(`      📊 Holdings count: ${Array.isArray(holdings) ? holdings.length : 'N/A'}`);
        
        if (Array.isArray(holdings) && holdings.length > 0) {
          console.log(`      📋 Holdings data:`);
          holdings.slice(0, 5).forEach((h: any, i: number) => {
            console.log(`         ${i + 1}. Symbol: ${h.symbol || 'N/A'}, Type: ${h.type || 'N/A'}, Name: ${h.name || h.symbol || 'N/A'}`);
          });
          if (holdings.length > 5) {
            console.log(`         ... and ${holdings.length - 5} more`);
          }
          
          // Test deduplication
          const seenSymbols = new Set<string>();
          const uniqueHoldings = holdings.filter((h: any) => {
            const symbol = (h.symbol || '').toUpperCase();
            if (seenSymbols.has(symbol)) {
              return false;
            }
            seenSymbols.add(symbol);
            return true;
          });
          
          const duplicatesRemoved = holdings.length - uniqueHoldings.length;
          if (duplicatesRemoved > 0) {
            console.log(`      🔍 Deduplication: Removed ${duplicatesRemoved} duplicate(s), ${uniqueHoldings.length} unique holdings`);
          } else {
            console.log(`      🔍 Deduplication: No duplicates found`);
          }
          
          foundHoldings = true;
          break;
        } else if (Array.isArray(holdings)) {
          console.log(`      ℹ️  User has no holdings (empty array)`);
        } else {
          console.log(`      ⚠️  Unexpected response format: ${JSON.stringify(holdings).substring(0, 100)}`);
        }
      } catch (error) {
        console.log(`      ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      }
      console.log('');
    }

    if (!foundHoldings) {
      console.log('⚠️  No holdings found for any user');
    }

    console.log('\n✅ Connection test complete!');
  } catch (error) {
    console.error('\n❌ Connection test failed:', error);
    process.exit(1);
  }
}

testFetchHoldings().catch(console.error);
