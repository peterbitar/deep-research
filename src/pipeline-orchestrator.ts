// Pipeline orchestrator for MVP
// Coordinates content scoring, holdings matching, price detection, and trigger agent

import type { Holding } from './holdings';
import { scoreArticle, type ArticleMetadata, type ArticleScore } from './content-scoring';
import { matchArticleToHoldings, type MatchResult } from './holdings-matching';
import { evaluateTrigger, checkPriceMoveTrigger, type ArticleWithScore } from './trigger-agent';
import { getPriceDataBatch, type PriceData, isSignificantPriceMove } from './price-detection';
import { deepResearch } from './deep-research';

export type EnrichedArticle = {
  article: ArticleMetadata;
  score: ArticleScore;
  matches: MatchResult[];
  approved: boolean;
  rejectionReason?: string;
};

export type PipelineResult = {
  enrichedArticles: EnrichedArticle[];
  deepResearchTriggered: Array<{
    type: 'article' | 'holding' | 'price-move' | 'macro-event';
    reason: string;
    holding?: Holding;
    article?: EnrichedArticle;
    priceData?: PriceData;
  }>;
  userPromptNeeded: Array<{
    article: EnrichedArticle;
    reason: string;
    escalationReason?: string;
  }>;
  priceAlerts: Array<{
    holding: Holding;
    priceData: PriceData;
    hasMatchedArticles: boolean;
  }>;
};

export type PipelineOptions = {
  holdings: Holding[];
  topHoldings?: Holding[]; // Top 3 holdings to prioritize
  interactive?: boolean; // If true, will prompt user for edge cases
  verbose?: boolean; // Debug logging
};

/**
 * Main pipeline orchestrator
 * Takes triaged articles and processes them through scoring, matching, and trigger logic
 */
export async function runPipeline(
  triagedArticles: ArticleMetadata[],
  options: PipelineOptions
): Promise<PipelineResult> {
  const { holdings, topHoldings, interactive = false, verbose = false } = options;
  
  // Default top holdings to first 3 if not specified
  const top3Holdings = topHoldings || holdings.slice(0, 3);
  
  if (verbose) {
    console.log(`\n🔍 Pipeline: Processing ${triagedArticles.length} articles for ${holdings.length} holdings`);
    console.log(`   Top holdings: ${top3Holdings.map(h => h.symbol).join(', ')}\n`);
  }
  
  // Step 1: Score and match articles
  const enrichedArticles: EnrichedArticle[] = [];
  
  for (const article of triagedArticles) {
    if (verbose) {
      console.log(`\n📄 Processing: ${article.title?.substring(0, 60) || article.url}...`);
    }
    
    // Score article
    const score = await scoreArticle(article, holdings, { verbose });
    if (verbose) {
      console.log(`   Impact: ${score.impact}/10, Relevance: ${score.relevanceToHoldings}, Composite: ${score.compositeScore.toFixed(2)}`);
    }
    
    // Match to holdings
    const matches = matchArticleToHoldings(article, holdings, { verbose });
    if (verbose && matches.length === 0) {
      console.log(`   Matches: None`);
    }
    
    // Determine if approved (simple logic: composite score >= 5 and has matches)
    const approved = score.compositeScore >= 5 && matches.length > 0;
    const rejectionReason = !approved 
      ? (score.compositeScore < 5 ? `Low composite score (${score.compositeScore.toFixed(2)})` : 'No holdings match')
      : undefined;
    
    enrichedArticles.push({
      article,
      score,
      matches,
      approved,
      rejectionReason,
    });
  }
  
  if (verbose) {
    console.log(`\n✅ Enriched ${enrichedArticles.length} articles`);
    console.log(`   Approved: ${enrichedArticles.filter(a => a.approved).length}`);
    console.log(`   Rejected: ${enrichedArticles.filter(a => !a.approved).length}\n`);
  }
  
  // Step 2: Check price moves
  const stockHoldings = holdings.filter(h => h.type === 'stock');
  const priceDataMap = await getPriceDataBatch(stockHoldings.map(h => h.symbol));
  
  const priceAlerts: PipelineResult['priceAlerts'] = [];
  for (const holding of stockHoldings) {
    const priceData = priceDataMap.get(holding.symbol);
    if (priceData && isSignificantPriceMove(priceData)) {
      const hasMatchedArticles = enrichedArticles.some(a => 
        a.approved && a.matches.some(m => m.holding.symbol === holding.symbol)
      );
      
      if (checkPriceMoveTrigger(holding, priceData.changePercent, hasMatchedArticles)) {
        priceAlerts.push({
          holding,
          priceData,
          hasMatchedArticles,
        });
      }
    }
  }
  
  if (verbose && priceAlerts.length > 0) {
    console.log(`\n📈 Price Alerts: ${priceAlerts.length} holdings with >5% moves`);
    priceAlerts.forEach(alert => {
      console.log(`   ${alert.holding.symbol}: ${alert.priceData.changePercent.toFixed(2)}% (${alert.hasMatchedArticles ? 'has articles' : 'no articles'})`);
    });
  }
  
  // Step 3: Evaluate triggers
  const triggerDecision = evaluateTrigger(enrichedArticles, holdings, top3Holdings);
  
  const deepResearchTriggered: PipelineResult['deepResearchTriggered'] = [];
  const userPromptNeeded: PipelineResult['userPromptNeeded'] = [];
  
  // Handle trigger decisions
  if (triggerDecision.shouldTriggerDeepResearch) {
    // Find the article that triggered it
    const triggeringArticle = enrichedArticles.find(a => 
      a.score.impact >= 7 && a.matches.length > 0 && !a.approved
    );
    
    deepResearchTriggered.push({
      type: 'article',
      reason: triggerDecision.reason,
      article: triggeringArticle,
    });
    
    if (verbose) {
      console.log(`\n🚀 Auto-triggering deep research: ${triggerDecision.reason}`);
    }
  }
  
  // Handle price move triggers
  for (const alert of priceAlerts) {
    if (!alert.hasMatchedArticles) {
      deepResearchTriggered.push({
        type: 'price-move',
        reason: `Unexplained price move: ${alert.holding.symbol} moved ${alert.priceData.changePercent.toFixed(2)}% with no matched articles`,
        holding: alert.holding,
        priceData: alert.priceData,
      });
      
      if (verbose) {
        console.log(`\n🚀 Auto-triggering deep research for price move: ${alert.holding.symbol}`);
      }
    }
  }
  
  // Handle user prompts
  if (triggerDecision.shouldAskUser) {
    const article = enrichedArticles.find(a => 
      a.score.impact >= 5 && a.score.impact <= 6 && a.matches.length > 0
    );
    
    if (article) {
      userPromptNeeded.push({
        article,
        reason: triggerDecision.reason,
        escalationReason: triggerDecision.escalationReason,
      });
      
      if (verbose) {
        console.log(`\n❓ User prompt needed: ${triggerDecision.reason}`);
      }
    }
  }
  
  // Check for no articles for top holdings
  const topHoldingSymbols = new Set(top3Holdings.map(h => h.symbol));
  const approvedForTopHoldings = enrichedArticles.filter(a => 
    a.approved && a.matches.some(m => topHoldingSymbols.has(m.holding.symbol))
  );
  
  if (approvedForTopHoldings.length === 0 && top3Holdings.length > 0) {
    deepResearchTriggered.push({
      type: 'holding',
      reason: `No approved articles found for top holdings: ${top3Holdings.map(h => h.symbol).join(', ')}`,
    });
    
    if (verbose) {
      console.log(`\n🚀 Auto-triggering deep research: No articles for top holdings`);
    }
  }
  
  return {
    enrichedArticles,
    deepResearchTriggered,
    userPromptNeeded,
    priceAlerts,
  };
}

/**
 * Execute deep research for triggered items
 */
export async function executeDeepResearch(
  triggers: PipelineResult['deepResearchTriggered'],
  holdings: Holding[],
  breadth = 3,
  depth = 1,
  verbose = false
): Promise<Array<{ trigger: PipelineResult['deepResearchTriggered'][0]; result: { learnings: string[]; visitedUrls: string[] } }>> {
  const results = [];
  
  for (const trigger of triggers) {
    if (verbose) {
      console.log(`\n🔬 Executing deep research for: ${trigger.reason}`);
    }
    
    let query = '';
    if (trigger.type === 'holding' && trigger.holding) {
      query = `Research factual updates for ${trigger.holding.symbol} (${trigger.holding.type}) in the last 7 days`;
    } else if (trigger.type === 'price-move' && trigger.holding) {
      query = `Research why ${trigger.holding.symbol} moved ${trigger.priceData?.changePercent.toFixed(2)}% in the last 7 days. Look for earnings, news, or events that explain this price movement.`;
    } else if (trigger.type === 'article' && trigger.article) {
      query = `Deep research on: ${trigger.article.article.title || trigger.article.article.url}`;
    } else {
      query = trigger.reason;
    }
    
    const result = await deepResearch({
      query,
      breadth,
      depth,
    });
    
    results.push({ trigger, result });
  }
  
  return results;
}
