// Macro & Liquidity Scan for Wealthy Rabbit

import { deepResearch } from './deep-research';

/**
 * Macro scan queries for central bank policy, economic data, currency, and geopolitics
 */
const MACRO_QUERIES = [
  {
    category: 'Central Bank Policy',
    queries: [
      'Fed rate decision January 2026 Reuters Bloomberg',
      'ECB rate decision January 2026 Financial Times',
      'Central bank policy statements January 2026',
    ],
  },
  {
    category: 'Economic Data',
    queries: [
      'CPI inflation data January 2026 Bureau of Labor Statistics',
      'Jobs report unemployment January 2026 BLS',
      'GDP growth data January 2026 Bureau of Economic Analysis',
    ],
  },
  {
    category: 'Currency Moves',
    queries: [
      'US Dollar index DXY January 2026 Bloomberg',
      'Currency movements USD EUR JPY January 2026',
    ],
  },
  {
    category: 'Geopolitical',
    queries: [
      'Geopolitical events oil markets January 2026 Reuters',
      'Trade policy tariffs January 2026 WSJ',
    ],
  },
];

export interface MacroResult {
  learnings: string[];
  visitedUrls: string[];
  categories: {
    centralBank?: string[];
    economicData?: string[];
    currency?: string[];
    geopolitical?: string[];
  };
}

/**
 * Scan macro and liquidity conditions
 */
export async function scanMacro(breadth = 2, depth = 1, dataSaver?: any): Promise<MacroResult> {
  console.log('\n🌍 Scanning macro & liquidity conditions...\n');
  
  const allLearnings: string[] = [];
  const allUrls: string[] = [];
  const categories: MacroResult['categories'] = {};
  
  // Research each macro category
  for (const categoryGroup of MACRO_QUERIES) {
    console.log(`  Scanning ${categoryGroup.category}...`);
    
    // Combine queries for this category
    const combinedQuery = `Macro ${categoryGroup.category}: ${categoryGroup.queries.join(', ')}`;
    const researchLabel = `Macro-${categoryGroup.category.replace(/\s+/g, '')}`;
    
    const { learnings, visitedUrls } = await deepResearch({
      query: combinedQuery,
      breadth,
      depth,
      dataSaver,
      researchLabel,
    });
    
    allLearnings.push(...learnings);
    allUrls.push(...visitedUrls);
    
    // Categorize learnings
    if (categoryGroup.category === 'Central Bank Policy') {
      categories.centralBank = learnings;
    } else if (categoryGroup.category === 'Economic Data') {
      categories.economicData = learnings;
    } else if (categoryGroup.category === 'Currency Moves') {
      categories.currency = learnings;
    } else if (categoryGroup.category === 'Geopolitical') {
      categories.geopolitical = learnings;
    }
  }
  
  return {
    learnings: allLearnings,
    visitedUrls: allUrls,
    categories,
  };
}
