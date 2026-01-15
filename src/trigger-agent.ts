// Trigger agent for pipeline MVP
// Determines when to trigger deep research based on article scores and matching

import type { Holding } from './holdings';
import type { ArticleScore } from './content-scoring';
import type { MatchResult } from './holdings-matching';

export type ArticleWithScore = {
  article: {
    url: string;
    title?: string;
    description?: string;
  };
  score: ArticleScore;
  matches: MatchResult[];
  approved: boolean;
  rejectionReason?: string;
};

export type TriggerDecision = {
  shouldTriggerDeepResearch: boolean;
  reason: string;
  shouldAskUser: boolean;
  escalationReason?: string;
};

/**
 * Determine if deep research should be triggered based on article scores
 */
export function evaluateTrigger(
  articles: ArticleWithScore[],
  holdings: Holding[],
  topHoldings: Holding[] // Top 3 holdings to prioritize
): TriggerDecision {
  // Check: No approved articles for top holdings
  const topHoldingSymbols = new Set(topHoldings.map(h => h.symbol));
  const approvedForTopHoldings = articles.filter(a => 
    a.approved && a.matches.some(m => topHoldingSymbols.has(m.holding.symbol))
  );
  
  if (approvedForTopHoldings.length === 0 && topHoldings.length > 0) {
    return {
      shouldTriggerDeepResearch: true,
      reason: `No approved articles found for top holdings: ${topHoldings.map(h => h.symbol).join(', ')}`,
      shouldAskUser: false,
    };
  }
  
  // Check: High-impact articles (score >= 7) that match holdings but were rejected
  const highImpactRejected = articles.filter(a =>
    a.score.impact >= 7 &&
    a.matches.length > 0 &&
    !a.approved
  );
  
  if (highImpactRejected.length > 0) {
    const article = highImpactRejected[0];
    return {
      shouldTriggerDeepResearch: true,
      reason: `High-impact article (impact: ${article.score.impact}) matched holdings but was rejected: ${article.rejectionReason || 'Unknown reason'}`,
      shouldAskUser: false,
      escalationReason: `Was rejection due to content quality or evaluator error? Impact: ${article.score.impact}, Matches: ${article.matches.map(m => m.holding.symbol).join(', ')}`,
    };
  }
  
  // Check: Mid-impact (5-6) with weak matches - ask user
  const midImpactWeak = articles.filter(a =>
    a.score.impact >= 5 &&
    a.score.impact <= 6 &&
    a.matches.length > 0 &&
    a.matches.every(m => m.confidence < 0.8)
  );
  
  if (midImpactWeak.length > 0) {
    const article = midImpactWeak[0];
    return {
      shouldTriggerDeepResearch: false,
      reason: `Mid-impact article (impact: ${article.score.impact}) with weak matches`,
      shouldAskUser: true,
      escalationReason: `Impact: ${article.score.impact}, Weak matches: ${article.matches.map(m => `${m.holding.symbol} (${m.confidence.toFixed(2)})`).join(', ')}. Escalate for deep research?`,
    };
  }
  
  // Default: No trigger needed
  return {
    shouldTriggerDeepResearch: false,
    reason: 'Sufficient approved articles found',
    shouldAskUser: false,
  };
}

/**
 * Check if price move trigger should activate
 */
export function checkPriceMoveTrigger(
  holding: Holding,
  priceChangePercent: number,
  hasMatchedArticles: boolean
): boolean {
  // Trigger if price moved >5% AND no articles matched
  return Math.abs(priceChangePercent) > 5 && !hasMatchedArticles;
}

/**
 * Check if macro event trigger should activate
 */
export function checkMacroTrigger(
  macroEvents: Array<{ type: string; severity: 'low' | 'medium' | 'high' }>
): boolean {
  // Trigger if any high-severity macro event
  return macroEvents.some(event => event.severity === 'high');
}
