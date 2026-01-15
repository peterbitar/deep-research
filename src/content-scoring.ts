// Content scoring for pipeline MVP
// Scores articles on Impact, Relevance, Time Relevance, and Source Quality

import { generateObject } from 'ai';
import { z } from 'zod';

import { getModel } from './ai/providers';
import { systemPrompt } from './prompt';

export type ArticleMetadata = {
  url: string;
  title?: string;
  description?: string;
  snippet?: string;
  publishedDate?: string;
};

export type ArticleScore = {
  impact: number; // 1-10
  relevanceToHoldings: number; // 0-1 (binary for MVP, can be float later)
  timeRelevance: boolean; // Published in last 7 days
  sourceQuality: number; // 0-1 bonus (Tier 1 = 1.0, Tier 2 = 0.5, Tier 3 = 0.0)
  compositeScore: number; // Combined score for filtering
  reasoning: string;
};

/**
 * Score an article on multiple dimensions
 */
export async function scoreArticle(
  article: ArticleMetadata,
  holdings: Array<{ symbol: string; type: 'stock' | 'crypto' | 'commodity' }>,
  options?: { verbose?: boolean }
): Promise<ArticleScore> {
  const verbose = options?.verbose || false;
  const holdingsList = holdings.map(h => h.symbol).join(', ');
  
  // Check source quality from URL (simple heuristic)
  const url = article.url.toLowerCase();
  const tier1Indicators = ['reuters.com', 'bloomberg.com', 'ft.com', 'wsj.com', 'sec.gov', 'eia.gov', 'opec.org', '.gov'];
  const tier2Indicators = ['cnbc.com', 'marketwatch.com', 'fool.com', 'investing.com'];
  const tier3Indicators = ['marketminute', 'financialcontent', 'brightpath', 'consulting', 'outlook', 'aggregator'];
  
  let sourceQuality = 0.5; // Default Tier 2
  if (tier1Indicators.some(indicator => url.includes(indicator))) {
    sourceQuality = 1.0;
  } else if (tier2Indicators.some(indicator => url.includes(indicator))) {
    sourceQuality = 0.5;
  } else if (tier3Indicators.some(indicator => url.includes(indicator))) {
    sourceQuality = 0.0;
  }
  
  // Check time relevance (simple check - in production, parse publishedDate)
  const timeRelevance = true; // Assume true for MVP (triage already filters)
  
  const articleText = `${article.title || ''}\n${article.description || article.snippet || ''}`;
  
  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Score this article on IMPACT (1-10) and RELEVANCE to holdings (0-1, where 1 = matches a holding, 0 = doesn't match).

User Holdings: ${holdingsList}

ARTICLE:
Title: ${article.title || 'No title'}
Description: ${article.description || article.snippet || 'No description'}
URL: ${article.url}

SCORING CRITERIA:

IMPACT (1-10):
- 9-10: Earnings releases, major regulatory actions, product launches, major partnerships, macro events (Fed decisions, conflicts)
- 7-8: Lawsuits, significant regulatory changes, strategic announcements, major contract wins
- 5-6: Moderate news, operational updates, minor partnerships, market developments
- 3-4: Low-impact news, industry trends, minor updates
- 1-2: Trivial news, noise, opinion pieces

High-impact indicators:
- Earnings, SEC filings (8-K, 10-Q, 10-K)
- Lawsuits, regulatory actions (SEC, FTC, DOJ)
- Product launches, roadmap changes
- Major partnerships, contract wins
- Macro linkage (Fed decisions, economic data, conflicts)

RELEVANCE TO HOLDINGS (0 or 1):
- 1: Article mentions or affects one or more holdings (${holdingsList})
- 0: Article doesn't mention or affect any holdings

Return scores and brief reasoning.`,
    schema: z.object({
      impact: z.number().min(1).max(10).describe('Impact score 1-10'),
      relevanceToHoldings: z.number().min(0).max(1).describe('Relevance to holdings (0 or 1 for MVP)'),
      reasoning: z.string().describe('Brief explanation of scores'),
    }),
  });
  
  // Calculate composite score (weighted)
  // Impact (0-10) * 0.6 + Relevance (0-1) * 10 * 0.3 + Source Quality (0-1) * 10 * 0.1
  const compositeScore = 
    (res.object.impact * 0.6) +
    (res.object.relevanceToHoldings * 10 * 0.3) +
    (sourceQuality * 10 * 0.1);
  
  if (verbose) {
    console.log(`   Scoring breakdown:`);
    console.log(`     Impact: ${res.object.impact}/10 (weight: 0.6) = ${(res.object.impact * 0.6).toFixed(2)}`);
    console.log(`     Relevance: ${res.object.relevanceToHoldings} (weight: 0.3) = ${(res.object.relevanceToHoldings * 10 * 0.3).toFixed(2)}`);
    console.log(`     Source Quality: ${sourceQuality} (weight: 0.1) = ${(sourceQuality * 10 * 0.1).toFixed(2)}`);
    console.log(`     Composite: ${compositeScore.toFixed(2)}`);
    console.log(`     Reasoning: ${res.object.reasoning}`);
  }
  
  return {
    impact: res.object.impact,
    relevanceToHoldings: res.object.relevanceToHoldings,
    timeRelevance,
    sourceQuality,
    compositeScore,
    reasoning: res.object.reasoning,
  };
}

/**
 * Batch score multiple articles
 */
export async function scoreArticles(
  articles: ArticleMetadata[],
  holdings: Array<{ symbol: string; type: 'stock' | 'crypto' | 'commodity' }>,
  options?: { verbose?: boolean }
): Promise<Array<ArticleScore & { article: ArticleMetadata }>> {
  const scores = await Promise.all(
    articles.map(async article => {
      const score = await scoreArticle(article, holdings, options);
      return { ...score, article };
    })
  );
  
  return scores;
}
