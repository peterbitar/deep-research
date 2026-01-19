// Database functions for reports and cards
import { pool } from './client';
import { parseReportToCards } from '../api';

export interface ReportCard {
  title: string;
  content: string;
  emoji?: string;
  ticker?: string;
  macro?: string;
  card_order: number;
}

export interface ReportData {
  runId: string;
  query: string;
  depth: number;
  breadth: number;
  reportMarkdown: string;
  sources: string[];
}

/**
 * Save report to database
 */
export async function saveReport(data: ReportData): Promise<void> {
  if (!pool) {
    throw new Error('Database not configured');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Save research run
    await client.query(
      `INSERT INTO research_runs (run_id, query, depth, breadth, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (run_id) DO UPDATE SET
         query = EXCLUDED.query,
         depth = EXCLUDED.depth,
         breadth = EXCLUDED.breadth,
         updated_at = CURRENT_TIMESTAMP`,
      [data.runId, data.query, data.depth, data.breadth, 'completed']
    );

    // Parse report to get opening and cards
    const parsed = parseReportToCards(data.reportMarkdown);

    // Save report
    await client.query(
      `INSERT INTO reports (run_id, report_markdown, opening)
       VALUES ($1, $2, $3)
       ON CONFLICT (run_id) DO UPDATE SET
         report_markdown = EXCLUDED.report_markdown,
         opening = EXCLUDED.opening,
         updated_at = CURRENT_TIMESTAMP`,
      [data.runId, data.reportMarkdown, parsed.opening]
    );

    // Delete existing cards and sources for this run
    await client.query('DELETE FROM report_cards WHERE run_id = $1', [data.runId]);
    await client.query('DELETE FROM report_sources WHERE run_id = $1', [data.runId]);

    // Save cards
    for (let i = 0; i < parsed.cards.length; i++) {
      const card = parsed.cards[i];
      // Determine ticker/macro from card title/content (simple detection)
      const ticker = card.title.match(/\b(AAPL|NVDA|TSLA|MSFT|GOOGL|XRP|BTC|ETH)\b/i)?.[0]?.toUpperCase() || null;
      const macro = card.title.match(/\b(Fed|ECB|Central Bank|Economic|Geopolitical)\b/i)?.[0] || null;

      await client.query(
        `INSERT INTO report_cards (run_id, title, content, emoji, ticker, macro, card_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [data.runId, card.title, card.content, card.emoji || null, ticker, macro, i]
      );
    }

    // Save sources
    for (let i = 0; i < data.sources.length; i++) {
      await client.query(
        `INSERT INTO report_sources (run_id, source_url, source_order)
         VALUES ($1, $2, $3)`,
        [data.runId, data.sources[i], i]
      );
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Get latest report from database
 */
export async function getLatestReport(): Promise<{
  runId: string;
  reportMarkdown: string;
  created_at: Date;
} | null> {
  if (!pool) return null;

  const result = await pool.query(
    `SELECT r.run_id, r.report_markdown, rr.created_at
     FROM reports r
     JOIN research_runs rr ON r.run_id = rr.run_id
     ORDER BY rr.created_at DESC
     LIMIT 1`
  );

  if (result.rows.length === 0) return null;

  return {
    runId: result.rows[0].run_id,
    reportMarkdown: result.rows[0].report_markdown,
    created_at: result.rows[0].created_at,
  };
}

/**
 * Get report cards from database
 */
export async function getReportCards(runId?: string): Promise<{
  runId: string;
  publishedDate: string;
  opening: string;
  cards: ReportCard[];
  sources: string[];
} | null> {
  if (!pool) return null;

  // Get latest run if no runId provided
  const targetRunId = runId || await getLatestRunId();
  if (!targetRunId) return null;

  // Get report
  const reportResult = await pool.query(
    `SELECT r.run_id, r.opening, rr.created_at
     FROM reports r
     JOIN research_runs rr ON r.run_id = rr.run_id
     WHERE r.run_id = $1`,
    [targetRunId]
  );

  if (reportResult.rows.length === 0) return null;

  // Get cards
  const cardsResult = await pool.query(
    `SELECT title, content, emoji, ticker, macro, card_order
     FROM report_cards
     WHERE run_id = $1
     ORDER BY card_order`,
    [targetRunId]
  );

  // Get sources
  const sourcesResult = await pool.query(
    `SELECT source_url
     FROM report_sources
     WHERE run_id = $1
     ORDER BY source_order`,
    [targetRunId]
  );

  return {
    runId: targetRunId,
    publishedDate: new Date(reportResult.rows[0].created_at).toISOString(),
    opening: reportResult.rows[0].opening || '',
    cards: cardsResult.rows.map(row => ({
      title: row.title,
      content: row.content,
      emoji: row.emoji,
      ticker: row.ticker,
      macro: row.macro,
      card_order: row.card_order,
    })),
    sources: sourcesResult.rows.map(row => row.source_url),
  };
}

/**
 * Get latest run ID
 */
async function getLatestRunId(): Promise<string | null> {
  if (!pool) return null;

  const result = await pool.query(
    `SELECT run_id FROM research_runs ORDER BY created_at DESC LIMIT 1`
  );

  return result.rows.length > 0 ? result.rows[0].run_id : null;
}
