// Holdings-based research for Wealthy Rabbit

import type { Holding } from './holdings';
import { deepResearch } from './deep-research';
import { generateHoldingQueries } from './holdings-queries';
import type { HoldingResult } from './wealthy-rabbit-report';

/**
 * Research a single holding for factual updates
 */
export async function researchHolding(
  holding: Holding,
  breadth = 3,
  depth = 1
): Promise<HoldingResult> {
  // Generate factual queries for this holding
  const queries = await generateHoldingQueries(holding, breadth);
  
  // Add a general search query to catch anything missed by specific queries
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const year = now.getFullYear();
  const generalQuery = `${holding.symbol} ${month} ${year}`;
  
  // Combine queries into a research query (include general search)
  const researchQuery = `Research factual updates for ${holding.symbol} (${holding.type}) in the last 7 days. Check for:
${queries.map(q => `- ${q.researchGoal}`).join('\n')}
- General news and developments (search: ${generalQuery})`;
  
  // Run deep research with breadth+1 to include general query
  const { learnings, visitedUrls } = await deepResearch({
    query: researchQuery,
    breadth: breadth + 1, // +1 for general search
    depth,
  });
  
  // Determine if there are factual updates
  // Look for [RECENT CHANGE] tags and factual keywords
  const factualKeywords = [
    'earnings', 'SEC filing', '8-K', '10-Q', '10-K',
    'regulatory', 'lawsuit', 'partnership', 'contract',
    'protocol upgrade', 'fork', 'ETF approval', 'institutional',
    'price', 'inventory', 'supply', 'demand', 'OPEC',
  ];
  
  const hasFactualUpdates = learnings.some(learning => {
    const lowerLearning = learning.toLowerCase();
    return (
      learning.includes('[RECENT CHANGE]') &&
      factualKeywords.some(keyword => lowerLearning.includes(keyword.toLowerCase()))
    );
  });
  
  return {
    holding,
    learnings,
    visitedUrls,
    hasFactualUpdates,
  };
}

/**
 * Research multiple holdings
 */
export async function researchHoldings(
  holdings: Holding[],
  breadth = 3,
  depth = 1
): Promise<HoldingResult[]> {
  const results: HoldingResult[] = [];
  
  for (const holding of holdings) {
    console.log(`\nResearching ${holding.symbol} (${holding.type})...`);
    const result = await researchHolding(holding, breadth, depth);
    results.push(result);
  }
  
  return results;
}
