// Utility to fetch holdings from user's app API

import { detectAssetType } from './holdings';
import { pool } from './db/client';

export interface FetchedHolding {
  symbol: string;
  type?: string;
  name?: string;
  [key: string]: any; // Allow additional fields
}

export interface HoldingsFetchConfig {
  baseURL?: string;
  userId: string; // user_id (string identifier), not numeric id
  healthCheck?: boolean;
}

/**
 * Fetch holdings directly from database (fallback method)
 * This assumes both services share the same PostgreSQL database
 */
async function fetchHoldingsFromDatabase(userId: string): Promise<Array<{ symbol: string; type: string; name: string }>> {
  if (!pool) {
    throw new Error('Database not available for holdings fallback');
  }

  try {
    // Try different possible table names and column names
    // The main backend might use different naming conventions
    const possibleQueries = [
      // Standard format
      {
        query: `SELECT symbol, name, allocation, note 
                FROM holding 
                WHERE user_id = $1 
                ORDER BY created_at DESC`,
        params: [userId]
      },
      // Alternative: user_id column name
      {
        query: `SELECT symbol, name, allocation, note 
                FROM holdings 
                WHERE user_id = $1 
                ORDER BY created_at DESC`,
        params: [userId]
      },
      // Alternative: different user identifier
      {
        query: `SELECT symbol, name, allocation, note 
                FROM holding 
                WHERE user_id::text = $1 
                ORDER BY created_at DESC`,
        params: [userId]
      }
    ];

    for (const { query, params } of possibleQueries) {
      try {
        const result = await pool.query(query, params);
        
        if (result.rows.length > 0) {
          console.log(`✅ Found ${result.rows.length} holdings in database`);
          
          // Map to internal format
          return result.rows.map((row) => {
            const symbol = row.symbol.toUpperCase().trim();
            const detectedType = detectAssetType(symbol);
            const typeDisplayName = 
              detectedType === 'crypto' ? 'Cryptocurrency' :
              detectedType === 'commodity' ? 'Commodity' :
              detectedType === 'stock' ? 'Stock' :
              'Unknown';

            return {
              symbol,
              type: typeDisplayName,
              name: row.name || row.symbol,
            };
          });
        }
      } catch (queryError: any) {
        // If this query format doesn't work, try next one
        if (queryError.code !== '42P01') {
          // Not a "table doesn't exist" error, log it
          console.log(`⚠️  Query failed: ${queryError.message}`);
        }
        continue;
      }
    }

    // If all queries returned no results, return empty array
    console.log('⚠️  No holdings found in database for user:', userId);
    return [];
  } catch (error: any) {
    // If all queries failed, throw with helpful message
    if (error.code === '42P01') {
      throw new Error('Holdings table not found in database. Services may use different databases.');
    }
    throw error;
  }
}

/**
 * Fetch holdings from user's app API with database fallback
 */
export async function fetchUserHoldings(config: HoldingsFetchConfig): Promise<Array<{ symbol: string; type: string; name: string }>> {
  const baseURL = config.baseURL || 'http://localhost:3001';
  const { userId, healthCheck = true } = config;

  // Try API first
  try {
    // Optional: Check health first
    if (healthCheck) {
      const healthResponse = await fetch(`${baseURL}/health`);
      if (!healthResponse.ok) {
        throw new Error('Backend is not available');
      }
    }

    // Fetch holdings from API
    const response = await fetch(`${baseURL}/api/holdings/${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Failed to fetch holdings' }));
      const errorMessage = errorData.error || `Failed to fetch holdings: ${response.status} ${response.statusText}`;
      
      // If API fails, try database fallback
      console.warn(`⚠️  API fetch failed (${response.status}): ${errorMessage}`);
      console.log('🔄 Attempting database fallback...');
      
      try {
        const holdings = await fetchHoldingsFromDatabase(userId);
        if (holdings.length > 0) {
          console.log(`✅ Successfully fetched ${holdings.length} holdings from database (fallback)`);
          return holdings;
        } else {
          throw new Error('No holdings found in database');
        }
      } catch (dbError: any) {
        // If database fallback also fails, throw original API error
        throw new Error(errorMessage);
      }
    }

    const holdings: FetchedHolding[] = await response.json();

    // Validate response
    if (!Array.isArray(holdings)) {
      throw new Error('Invalid response format: expected array of holdings');
    }

    // Map to internal format
    // Note: API doesn't provide 'type' field, so we auto-detect from symbol
    return holdings.map((holding) => {
      if (!holding.symbol) {
        throw new Error('Invalid holding: missing symbol field');
      }
      
      const symbol = holding.symbol.toUpperCase().trim();
      const detectedType = detectAssetType(symbol);
      const typeDisplayName = 
        detectedType === 'crypto' ? 'Cryptocurrency' :
        detectedType === 'commodity' ? 'Commodity' :
        detectedType === 'stock' ? 'Stock' :
        'Unknown';

      return {
        symbol,
        type: typeDisplayName, // Use display name for compatibility with test-holdings-macro.ts
        name: holding.name || holding.symbol,
      };
    });
  } catch (error: any) {
    // If it's not already a handled error, try database fallback
    if (error.message && !error.message.includes('Backend is not available')) {
      console.warn(`⚠️  API error: ${error.message}`);
      console.log('🔄 Attempting database fallback...');
      
      try {
        const holdings = await fetchHoldingsFromDatabase(userId);
        if (holdings.length > 0) {
          console.log(`✅ Successfully fetched ${holdings.length} holdings from database (fallback)`);
          return holdings;
        }
      } catch (dbError: any) {
        // Database fallback failed, throw original error
        console.error('❌ Database fallback also failed:', dbError.message);
      }
    }
    
    // Re-throw original error if all methods failed
    console.error('Error fetching holdings:', error);
    throw error;
  }
}
