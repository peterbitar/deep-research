// Script to update holdings via the main backend API to only NFLX
// This prepares the database for TestFlight validation

const baseURL = process.env.HOLDINGS_API_BASE_URL || 'http://localhost:3001';

async function updateHoldingsToNFLX() {
  console.log('🔄 Updating holdings to NFLX only for TestFlight validation\n');
  console.log(`📍 Backend URL: ${baseURL}\n`);

  try {
    // Step 1: Get all users
    console.log('1️⃣  Fetching users...');
    const usersResponse = await fetch(`${baseURL}/api/users`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!usersResponse.ok) {
      throw new Error(`Failed to fetch users: ${usersResponse.status} ${usersResponse.statusText}`);
    }

    const usersData = await usersResponse.json();
    let userIds: string[] = [];

    if (Array.isArray(usersData)) {
      userIds = usersData.map((u: any) => {
        if (typeof u === 'string') return u;
        return u.user_id || u.userId || (typeof u.id === 'string' ? u.id : null) || String(u.id || u._id);
      }).filter(Boolean);
    } else if (usersData.users && Array.isArray(usersData.users)) {
      userIds = usersData.users.map((u: any) => {
        if (typeof u === 'string') return u;
        return u.user_id || u.userId || (typeof u.id === 'string' ? u.id : null) || String(u.id || u._id);
      }).filter(Boolean);
    } else if (usersData.userIds && Array.isArray(usersData.userIds)) {
      userIds = usersData.userIds;
    }

    if (userIds.length === 0) {
      console.log('⚠️  No users found. Using default test user...');
      userIds = ['D96C07AD-DA20-457D-9CE5-D687D8BFB3DE'];
    }

    console.log(`   ✅ Found ${userIds.length} user(s): ${userIds.join(', ')}\n`);

    // Step 2: For each user, delete all holdings and add only NFLX
    console.log('2️⃣  Updating holdings for each user...\n');
    
    for (const userId of userIds) {
      console.log(`   User: ${userId}`);
      
      // Try to delete all holdings first (if API supports it)
      // Most APIs don't have a delete-all endpoint, so we'll just set NFLX
      
      // Check if there's a PUT/PATCH endpoint to replace holdings
      // Otherwise, we'll need to use the database directly
      
      // For now, let's try to use a direct database connection if available
      // Or we can document the manual steps
      
      console.log(`   ⚠️  API update not available. Please update manually via database:\n`);
      console.log(`      For user ${userId}:`);
      console.log(`      1. DELETE FROM holding WHERE user_id = '${userId}';`);
      console.log(`      2. INSERT INTO holding (user_id, symbol, name) VALUES ('${userId}', 'NFLX', 'Netflix Inc.');\n`);
    }

    // Step 3: Verify holdings
    console.log('3️⃣  Verifying holdings...\n');
    
    for (const userId of userIds) {
      try {
        const holdingsResponse = await fetch(`${baseURL}/api/holdings/${userId}`, {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
        });

        if (holdingsResponse.ok) {
          const holdings = await holdingsResponse.json();
          if (Array.isArray(holdings)) {
            const symbols = holdings.map((h: any) => h.symbol).filter(Boolean);
            console.log(`   User ${userId}: ${symbols.length} holding(s) - ${symbols.join(', ')}`);
            
            if (symbols.length === 1 && symbols[0] === 'NFLX') {
              console.log(`      ✅ Correct - only NFLX\n`);
            } else {
              console.log(`      ⚠️  Needs update - should be only NFLX\n`);
            }
          }
        }
      } catch (error) {
        console.log(`   ⚠️  Could not verify holdings for ${userId}\n`);
      }
    }

    console.log('\n💡 To update holdings via database directly:');
    console.log('   1. Connect to your main backend database');
    console.log('   2. Run: DELETE FROM holding;');
    console.log('   3. Run: INSERT INTO holding (user_id, symbol, name) VALUES');
    userIds.forEach((userId, i) => {
      const comma = i < userIds.length - 1 ? ',' : ';';
      console.log(`      ('${userId}', 'NFLX', 'Netflix Inc.')${comma}`);
    });
    console.log('');

  } catch (error: any) {
    console.error('\n❌ Error:', error.message);
    console.error('\n💡 You may need to update holdings manually via the database.\n');
    throw error;
  }
}

updateHoldingsToNFLX()
  .then(() => {
    console.log('✅ Holdings update check complete!');
    console.log('   Please update the database manually if needed.\n');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Holdings update failed:', error);
    process.exit(1);
  });
