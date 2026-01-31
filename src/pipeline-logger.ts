// Pipeline logger - tracks all articles and decisions, exports to Excel
// Records what is found, filtered out, and chosen with explanations

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { generateObject } from './ai/generate-with-cost-log';
import { z } from 'zod';

import { getModel } from './ai/providers';
import { systemPrompt } from './prompt';
import type { Holding } from './holdings';
import type { ArticleMetadata } from './content-scoring';
import type { ArticleScore } from './content-scoring';
import type { MatchResult } from './holdings-matching';
import type { EnrichedArticle } from './pipeline-orchestrator';

export type ArticleRecord = {
  timestamp: string;
  holdingSymbol?: string;
  url: string;
  title: string;
  description: string;
  source: string;
  
  // Scoring
  impactScore: number;
  relevanceScore: number;
  sourceQuality: number;
  compositeScore: number;
  scoringReasoning: string;
  
  // Matching
  matchedHoldings: string; // Comma-separated symbols
  matchType: string; // symbol, entity, soft-link
  matchConfidence: number;
  
  // Decision
  status: 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  decisionExplanation: string;
  
  // Metadata
  foundInQuery?: string;
  triaged: boolean;
};

export type TestSession = {
  sessionId: string;
  timestamp: string;
  holdings: string;
  totalArticlesFound: number;
  totalArticlesTriaged: number;
  totalArticlesScored: number;
  totalApproved: number;
  totalRejected: number;
  records: ArticleRecord[];
};

/**
 * Generate explanation for approval/rejection decision using LLM
 */
async function generateDecisionExplanation(
  article: EnrichedArticle,
  holdings: Holding[]
): Promise<string> {
  const holdingsList = holdings.map(h => h.symbol).join(', ');
  const matchedSymbols = article.matches.map(m => m.holding.symbol).join(', ');
  
  const res = await generateObject({
    model: getModel(),
    system: systemPrompt(),
    prompt: `Explain why this article was ${article.approved ? 'APPROVED' : 'REJECTED'} in the pipeline.

HOLDINGS: ${holdingsList}

ARTICLE:
Title: ${article.article.title || 'No title'}
Description: ${article.article.description || article.article.snippet || 'No description'}
URL: ${article.article.url}

SCORES:
- Impact: ${article.score.impact}/10
- Relevance: ${article.score.relevanceToHoldings}
- Source Quality: ${article.score.sourceQuality}
- Composite: ${article.score.compositeScore.toFixed(2)}

MATCHES: ${matchedSymbols || 'None'}
${article.matches.length > 0 ? article.matches.map(m => `  - ${m.holding.symbol} (${m.matchType}, ${(m.confidence * 100).toFixed(0)}%)`).join('\n') : ''}

DECISION: ${article.approved ? 'APPROVED' : 'REJECTED'}
${article.rejectionReason ? `Rejection Reason: ${article.rejectionReason}` : ''}

Provide a clear, concise explanation (2-3 sentences) of why this article was ${article.approved ? 'approved' : 'rejected'} based on the scores, matches, and decision criteria.`,
    schema: z.object({
      explanation: z.string().describe('Explanation of the decision'),
    }),
  });
  
  return res.object.explanation;
}

/**
 * Create article record from enriched article
 */
export async function createArticleRecord(
  article: EnrichedArticle,
  holdings: Holding[],
  options?: {
    holdingSymbol?: string;
    foundInQuery?: string;
    triaged?: boolean;
  }
): Promise<ArticleRecord> {
  const { holdingSymbol, foundInQuery, triaged = true } = options || {};
  
  // Generate decision explanation
  const decisionExplanation = await generateDecisionExplanation(article, holdings);
  
  // Extract source from URL
  const urlObj = new URL(article.article.url);
  const source = urlObj.hostname.replace('www.', '');
  
  return {
    timestamp: new Date().toISOString(),
    holdingSymbol,
    url: article.article.url,
    title: article.article.title || 'No title',
    description: article.article.description || article.article.snippet || 'No description',
    source,
    
    // Scoring
    impactScore: article.score.impact,
    relevanceScore: article.score.relevanceToHoldings,
    sourceQuality: article.score.sourceQuality,
    compositeScore: article.score.compositeScore,
    scoringReasoning: article.score.reasoning,
    
    // Matching
    matchedHoldings: article.matches.map(m => m.holding.symbol).join(', ') || 'None',
    matchType: article.matches.length > 0 ? article.matches.map(m => m.matchType).join(', ') : 'None',
    matchConfidence: article.matches.length > 0 ? Math.max(...article.matches.map(m => m.confidence)) : 0,
    
    // Decision
    status: article.approved ? 'APPROVED' : 'REJECTED',
    rejectionReason: article.rejectionReason,
    decisionExplanation,
    
    // Metadata
    foundInQuery,
    triaged,
  };
}

/**
 * Export test session to Excel
 */
export async function exportToExcel(
  session: TestSession,
  outputPath: string
): Promise<void> {
  // Create workbook
  const wb = XLSX.utils.book_new();
  
  // Summary sheet
  const summaryData = [
    ['Test Session Summary'],
    [''],
    ['Session ID', session.sessionId],
    ['Timestamp', session.timestamp],
    ['Holdings', session.holdings],
    [''],
    ['Statistics'],
    ['Total Articles Found', session.totalArticlesFound],
    ['Total Articles Triaged', session.totalArticlesTriaged],
    ['Total Articles Scored', session.totalArticlesScored],
    ['Total Approved', session.totalApproved],
    ['Total Rejected', session.totalRejected],
    ['Approval Rate', `${((session.totalApproved / session.totalArticlesScored) * 100).toFixed(2)}%`],
  ];
  
  const summaryWS = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(wb, summaryWS, 'Summary');
  
  // Articles sheet
  const articlesData = session.records.map(record => [
    record.timestamp,
    record.holdingSymbol || '',
    record.url,
    record.title,
    record.description,
    record.source,
    record.impactScore,
    record.relevanceScore,
    record.sourceQuality,
    record.compositeScore,
    record.scoringReasoning,
    record.matchedHoldings,
    record.matchType,
    record.matchConfidence,
    record.status,
    record.rejectionReason || '',
    record.decisionExplanation,
    record.foundInQuery || '',
    record.triaged ? 'Yes' : 'No',
  ]);
  
  const articlesWS = XLSX.utils.aoa_to_sheet([
    [
      'Timestamp',
      'Holding',
      'URL',
      'Title',
      'Description',
      'Source',
      'Impact Score',
      'Relevance Score',
      'Source Quality',
      'Composite Score',
      'Scoring Reasoning',
      'Matched Holdings',
      'Match Type',
      'Match Confidence',
      'Status',
      'Rejection Reason',
      'Decision Explanation',
      'Found In Query',
      'Triaged',
    ],
    ...articlesData,
  ]);
  
  // Auto-size columns
  const colWidths = [
    { wch: 20 }, // Timestamp
    { wch: 10 }, // Holding
    { wch: 50 }, // URL
    { wch: 50 }, // Title
    { wch: 80 }, // Description
    { wch: 25 }, // Source
    { wch: 12 }, // Impact Score
    { wch: 15 }, // Relevance Score
    { wch: 15 }, // Source Quality
    { wch: 15 }, // Composite Score
    { wch: 80 }, // Scoring Reasoning
    { wch: 20 }, // Matched Holdings
    { wch: 15 }, // Match Type
    { wch: 15 }, // Match Confidence
    { wch: 12 }, // Status
    { wch: 30 }, // Rejection Reason
    { wch: 100 }, // Decision Explanation
    { wch: 50 }, // Found In Query
    { wch: 10 }, // Triaged
  ];
  articlesWS['!cols'] = colWidths;
  
  XLSX.utils.book_append_sheet(wb, articlesWS, 'Articles');
  
  // Write file
  XLSX.writeFile(wb, outputPath);
}

/**
 * Create test session from pipeline results
 */
export async function createTestSession(
  enrichedArticles: EnrichedArticle[],
  holdings: Holding[],
  options?: {
    holdingSymbol?: string;
    totalArticlesFound?: number;
    totalArticlesTriaged?: number;
  }
): Promise<TestSession> {
  const { holdingSymbol, totalArticlesFound = 0, totalArticlesTriaged = 0 } = options || {};
  const sessionId = `test-${Date.now()}`;
  const timestamp = new Date().toISOString();
  
  // Create records for all articles
  const records = await Promise.all(
    enrichedArticles.map(article => 
      createArticleRecord(article, holdings, { holdingSymbol, triaged: true })
    )
  );
  
  const approved = records.filter(r => r.status === 'APPROVED').length;
  const rejected = records.filter(r => r.status === 'REJECTED').length;
  
  return {
    sessionId,
    timestamp,
    holdings: holdings.map(h => h.symbol).join(', '),
    totalArticlesFound,
    totalArticlesTriaged,
    totalArticlesScored: records.length,
    totalApproved: approved,
    totalRejected: rejected,
    records,
  };
}
