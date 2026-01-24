// Holdings research with pipeline integration
// Uses pipeline orchestrator to score, match, and conditionally trigger deep research

import type { Holding } from './holdings';
import { generateHoldingQueries } from './holdings-queries';
import { runPipeline, executeDeepResearch, type PipelineResult } from './pipeline-orchestrator';
import type { ArticleMetadata } from './content-scoring';
import { deepResearch } from './deep-research';
import type { HoldingResult } from './wealthy-rabbit-report';
import FirecrawlApp from '@mendable/firecrawl-js';
import { retryFirecrawlSearch, triageTitles } from './deep-research';

// Helper to get triageTitles - we need to export it or recreate the logic
// For now, we'll use a simplified approach: get articles from search, then pipeline

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY || '',
  baseURL: process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
});

/**
 * Research a holding using the pipeline approach
 * Gets articles, scores them, matches to holdings, and conditionally triggers deep research
 */
export async function researchHoldingWithPipeline(
  holding: Holding,
  allHoldings: Holding[], // All holdings for matching context
  breadth = 3,
  depth = 1,
  verbose = false
): Promise<HoldingResult & { pipelineResult?: PipelineResult }> {
  // Generate factual queries for this holding
  const queries = await generateHoldingQueries(holding, breadth);
  
  // Add a general search query
  const now = new Date();
  const month = now.toLocaleString('en-US', { month: 'long' });
  const year = now.getFullYear();
  const generalQuery = `${holding.symbol} ${month} ${year}`;
  
  // Combine queries into a research query
  const researchQuery = `Research factual updates for ${holding.symbol} (${holding.type}) in the last 7 days. Check for:
${queries.map(q => `- ${q.researchGoal}`).join('\n')}
- General news and developments (search: ${generalQuery})`;
  
  // Generate SERP queries (simplified - in production, use generateSerpQueries from deep-research)
  const serpQueries = [
    ...queries.map(q => ({ query: q.query, researchGoal: q.researchGoal })),
    { query: generalQuery, researchGoal: 'General news and developments' },
  ].slice(0, breadth + 1);
  
  // Step 1: Search and get articles (metadata only)
  const allTriagedArticles: ArticleMetadata[] = [];
  
  for (const serpQuery of serpQueries) {
    try {
      const searchResult = await retryFirecrawlSearch(
        () => firecrawl.search(serpQuery.query, {
          limit: 30,
        }),
        serpQuery.query
      );
      
      // Triage titles
      const triagedUrls = await triageTitles({
        query: serpQuery.query,
        results: searchResult.data.map(item => ({
          url: item.url,
          title: (item as any).title || (item as any).metadata?.title,
          description: (item as any).description || (item as any).snippet,
          snippet: (item as any).snippet,
        })),
        researchGoal: serpQuery.researchGoal,
      });
      
      // Get triaged articles
      const triagedArticles = searchResult.data
        .filter(item => triagedUrls.includes(item.url))
        .map(item => ({
          url: item.url,
          title: (item as any).title || (item as any).metadata?.title,
          description: (item as any).description || (item as any).snippet,
          snippet: (item as any).snippet,
        }));
      
      allTriagedArticles.push(...triagedArticles);
    } catch (error) {
      console.warn(`Error searching for ${serpQuery.query}:`, error);
    }
  }
  
  if (verbose) {
    console.log(`\n📰 Found ${allTriagedArticles.length} triaged articles for ${holding.symbol}`);
  }
  
  // Step 2: Run pipeline
  const pipelineResult = await runPipeline(allTriagedArticles, {
    holdings: allHoldings,
    topHoldings: allHoldings.slice(0, 3),
    interactive: false,
    verbose,
  });
  
  // Step 3: Execute deep research if triggered
  let learnings: string[] = [];
  let visitedUrls: string[] = [];
  
  if (pipelineResult.deepResearchTriggered.length > 0) {
    if (verbose) {
      console.log(`\n🚀 Pipeline triggered deep research for ${holding.symbol}`);
    }
    
    const deepResearchResults = await executeDeepResearch(
      pipelineResult.deepResearchTriggered.filter(t => 
        t.type === 'article' || (t.type === 'holding' && t.holding?.symbol === holding.symbol)
      ),
      allHoldings,
      breadth,
      depth,
      verbose
    );
    
    // Combine learnings from all deep research results
    for (const result of deepResearchResults) {
      learnings.push(...result.result.learnings);
      visitedUrls.push(...result.result.visitedUrls);
    }
  } else {
    // No deep research triggered - use approved articles' metadata
    const approvedArticles = pipelineResult.enrichedArticles.filter(a => a.approved);
    if (approvedArticles.length > 0) {
      learnings = approvedArticles.map(a => 
        `[METADATA] ${a.article.title || a.article.url}: ${a.article.description || a.article.snippet}`
      );
      visitedUrls = approvedArticles.map(a => a.article.url);
    }
  }
  
  // Determine if there are factual updates
  const factualKeywords = [
    'earnings', 'SEC filing', '8-K', '10-Q', '10-K',
    'regulatory', 'lawsuit', 'partnership', 'contract',
    'protocol upgrade', 'fork', 'ETF approval', 'institutional',
    'price', 'inventory', 'supply', 'demand', 'OPEC',
  ];
  
  const hasFactualUpdates = learnings.some(learning => {
    const lowerLearning = learning.toLowerCase();
    return (
      learning.includes('[RECENT CHANGE]') || learning.includes('[METADATA]')
    ) && factualKeywords.some(keyword => lowerLearning.includes(keyword.toLowerCase()));
  });
  
  return {
    holding,
    learnings,
    visitedUrls,
    hasFactualUpdates,
    pipelineResult,
  };
}

/**
 * Research multiple holdings using pipeline approach
 */
export async function researchHoldingsWithPipeline(
  holdings: Holding[],
  breadth = 3,
  depth = 1,
  verbose = false
): Promise<Array<HoldingResult & { pipelineResult?: PipelineResult }>> {
  const results = [];
  
  for (const holding of holdings) {
    console.log(`\nResearching ${holding.symbol} (${holding.type}) with pipeline...`);
    const result = await researchHoldingWithPipeline(holding, holdings, breadth, depth, verbose);
    results.push(result);
  }
  
  return results;
}
