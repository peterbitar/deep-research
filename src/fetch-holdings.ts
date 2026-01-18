// Utility to fetch holdings from user's app API

import { detectAssetType } from './holdings';

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
 * Fetch holdings from user's app API
 */
export async function fetchUserHoldings(config: HoldingsFetchConfig): Promise<Array<{ symbol: string; type: string; name: string }>> {
  const baseURL = config.baseURL || 'http://localhost:3001';
  const { userId, healthCheck = true } = config;

  try {
    // Optional: Check health first
    if (healthCheck) {
      const healthResponse = await fetch(`${baseURL}/health`);
      if (!healthResponse.ok) {
        throw new Error('Backend is not available');
      }
    }

    // Fetch holdings
    const response = await fetch(`${baseURL}/api/holdings/${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Failed to fetch holdings' }));
      throw new Error(error.error || `Failed to fetch holdings: ${response.status} ${response.statusText}`);
    }

    const holdings: FetchedHolding[] = await response.json();

    // Map to internal format
    // Note: API doesn't provide 'type' field, so we auto-detect from symbol
    return holdings.map((holding) => {
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
  } catch (error) {
    console.error('Error fetching holdings:', error);
    throw error;
  }
}
