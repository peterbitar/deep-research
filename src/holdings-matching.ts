// Holdings matching for pipeline MVP
// Matches articles to user holdings using symbol + entity matching

import type { Holding } from './holdings';
import { getAssetName } from './holdings';

export type ArticleMetadata = {
  url: string;
  title?: string;
  description?: string;
  snippet?: string;
};

export type MatchResult = {
  holding: Holding;
  matchType: 'symbol' | 'entity' | 'soft-link';
  confidence: number; // 0-1
  matchedText?: string;
};

/**
 * Match an article to holdings using symbol + entity matching (MVP)
 */
export function matchArticleToHoldings(
  article: ArticleMetadata,
  holdings: Holding[],
  options?: { verbose?: boolean }
): MatchResult[] {
  const verbose = options?.verbose || false;
  const matches: MatchResult[] = [];
  const articleText = `${article.title || ''} ${article.description || article.snippet || ''}`.toLowerCase();
  
  for (const holding of holdings) {
    const symbol = holding.symbol.toUpperCase();
    const symbolLower = symbol.toLowerCase();
    const assetName = getAssetName(holding).toLowerCase();
    
    // Symbol-based matching (fast + high precision)
    if (articleText.includes(symbolLower) || articleText.includes(`$${symbolLower}`)) {
      const match = {
        holding,
        matchType: 'symbol' as const,
        confidence: 0.95,
        matchedText: symbol,
      };
      matches.push(match);
      if (verbose) {
        console.log(`     Matched ${holding.symbol} via symbol (confidence: 95%)`);
      }
      continue; // Found symbol match, skip entity matching for this holding
    }
    
    // Special case: S&P 500 / SPY matching
    if ((symbol === 'SPY' || symbol === 'SPX') && 
        (articleText.includes('s&p 500') || articleText.includes('s&p500') || articleText.includes('sp 500'))) {
      const match = {
        holding,
        matchType: 'entity' as const,
        confidence: 0.9,
        matchedText: 'S&P 500',
      };
      matches.push(match);
      if (verbose) {
        console.log(`     Matched ${holding.symbol} via S&P 500 reference (confidence: 90%)`);
      }
      continue;
    }
    
    // Entity matching (Apple Inc., Nvidia Corporation, etc.)
    // Match if the primary word (first significant word) appears in the article
    // "NVIDIA" should match "NVIDIA Corporation", "Apple" should match "Apple Inc."
    const nameWords = assetName.split(/\s+/).filter(w => w.length >= 3); // Filter meaningful words only
    const primaryWord = nameWords[0]; // Use first significant word as primary
    
    if (primaryWord && articleText.includes(primaryWord)) {
      const match = {
        holding,
        matchType: 'entity' as const,
        confidence: 0.8, // Lower confidence than symbol match
        matchedText: assetName,
      };
      matches.push(match);
      if (verbose) {
        console.log(`     Matched ${holding.symbol} via entity "${assetName}" (primary word: ${primaryWord}) (confidence: 80%)`);
      }
    }
  }
  
  return matches;
}

/**
 * Check if article matches any holding
 */
export function articleMatchesHoldings(
  article: ArticleMetadata,
  holdings: Holding[]
): boolean {
  const matches = matchArticleToHoldings(article, holdings);
  return matches.length > 0;
}

/**
 * Get top matches (sorted by confidence)
 */
export function getTopMatches(
  matches: MatchResult[],
  limit = 3
): MatchResult[] {
  return matches
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, limit);
}
