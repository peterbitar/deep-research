// Test script to fetch users from iOS App Backend

async function testFetchUsers() {
  console.log('🔍 Testing iOS App Backend - Fetch Users\n');

  const baseURL = 'https://wealthyrabbitios-production-03a4.up.railway.app';

  try {
    // Test 1: Fetch all users
    console.log('Test 1: Fetching all users from /api/users');
    const usersResponse = await fetch(`${baseURL}/api/users`);
    
    if (!usersResponse.ok) {
      console.error(`❌ Error: ${usersResponse.status} ${usersResponse.statusText}`);
      return;
    }

    const users = await usersResponse.json();
    console.log(`✅ Success! Found ${Array.isArray(users) ? users.length : 0} users\n`);

    if (Array.isArray(users) && users.length > 0) {
      console.log('User Details:');
      users.forEach((user: any, index: number) => {
        console.log(`\nUser ${index + 1}:`);
        console.log(`  user_id: ${user.user_id || user.id || 'N/A'}`);
        console.log(`  push_token: ${user.push_token || 'null'}`);
        console.log(`  max_daily_pushes: ${user.max_daily_pushes || 'N/A'}`);
        console.log(`  created_at: ${user.created_at || 'N/A'}`);
      });

      // Test 2: Fetch holdings for each user
      console.log('\n\nTest 2: Fetching holdings for each user');
      for (const user of users.slice(0, 5)) { // Limit to first 5 users
        const userId = user.user_id || user.id;
        if (!userId) continue;

        console.log(`\n  User: ${userId}`);
        try {
          const holdingsResponse = await fetch(`${baseURL}/api/holdings/${userId}`);
          
          if (holdingsResponse.ok) {
            const holdings = await holdingsResponse.json();
            if (Array.isArray(holdings)) {
              console.log(`    ✅ ${holdings.length} holdings found:`);
              holdings.forEach((h: any) => {
                console.log(`       - ${h.symbol}: ${h.name || 'N/A'}`);
              });
            } else {
              console.log(`    ⚠️  Unexpected response format:`, holdings);
            }
          } else {
            const error = await holdingsResponse.json().catch(() => ({ error: 'Unknown error' }));
            console.log(`    ⚠️  Error: ${error.error || holdingsResponse.statusText}`);
          }
        } catch (error: any) {
          console.log(`    ❌ Failed to fetch holdings: ${error.message}`);
        }
      }
    } else {
      console.log('⚠️  No users found or unexpected response format');
      console.log('Response:', users);
    }

    // Summary
    console.log('\n\n📊 Summary:');
    console.log('✅ Users endpoint is accessible');
    console.log(`✅ Found ${Array.isArray(users) ? users.length : 0} user(s)`);
    console.log('\n💡 You can use these user_ids to test personalization:');
    if (Array.isArray(users)) {
      users.forEach((user: any) => {
        const userId = user.user_id || user.id;
        if (userId) {
          console.log(`   - ${userId}`);
        }
      });
    }

  } catch (error: any) {
    console.error('❌ Error fetching users:', error.message);
  }
}

testFetchUsers().catch(console.error);
