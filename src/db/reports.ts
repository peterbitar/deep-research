// Database functions for reports and cards
import { pool } from './client';
import { parseReportToCards } from '../report-parser';

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

    // Extract ticker from query if it mentions a company/stock
    const queryUpper = data.query.toUpperCase();
    const queryTicker = queryUpper.match(/\b(NFLX|NETFLIX|AAPL|APPLE|NVDA|NVIDIA|TSLA|TESLA|MSFT|MICROSOFT|GOOGL|GOOGLE|AMZN|AMAZON|META|XRP|BTC|BITCOIN|ETH|ETHEREUM|SOL|SOLANA)\b/i)?.[0];
    let defaultTicker: string | null = null;
    if (queryTicker) {
      // Map full names to symbols
      const tickerMap: Record<string, string> = {
        'NETFLIX': 'NFLX',
        'APPLE': 'AAPL',
        'NVIDIA': 'NVDA',
        'TESLA': 'TSLA',
        'MICROSOFT': 'MSFT',
        'GOOGLE': 'GOOGL',
        'AMAZON': 'AMZN',
        'BITCOIN': 'BTC',
        'ETHEREUM': 'ETH',
        'SOLANA': 'SOL',
      };
      defaultTicker = tickerMap[queryTicker.toUpperCase()] || queryTicker.toUpperCase();
    }

    // Save cards
    for (let i = 0; i < parsed.cards.length; i++) {
      const card = parsed.cards[i];
      // Determine ticker/macro from card title/content, fallback to query ticker
      const cardTitleUpper = card.title.toUpperCase();
      const cardContentUpper = card.content.toUpperCase();
      
      // Check for ticker in card (expanded list including NFLX)
      const cardTickerMatch = cardTitleUpper.match(/\b(NFLX|NETFLIX|AAPL|APPLE|NVDA|NVIDIA|TSLA|TESLA|MSFT|MICROSOFT|GOOGL|GOOGLE|AMZN|AMAZON|META|XRP|BTC|BITCOIN|ETH|ETHEREUM|SOL|SOLANA)\b/i)?.[0];
      
      // Check if this is a macro card BEFORE assigning ticker
      const macro = card.title.match(/\b(Fed|ECB|Central Bank|Economic|Geopolitical)\b/i)?.[0] || null;
      
      let ticker: string | null = null;
      if (cardTickerMatch) {
        // Card explicitly mentions a ticker - use it
        const tickerMap: Record<string, string> = {
          'NETFLIX': 'NFLX',
          'APPLE': 'AAPL',
          'NVIDIA': 'NVDA',
          'TESLA': 'TSLA',
          'MICROSOFT': 'MSFT',
          'GOOGLE': 'GOOGL',
          'AMAZON': 'AMZN',
          'BITCOIN': 'BTC',
          'ETHEREUM': 'ETH',
          'SOLANA': 'SOL',
        };
        ticker = tickerMap[cardTickerMatch.toUpperCase()] || cardTickerMatch.toUpperCase();
      } else if (defaultTicker && !macro) {
        // Fallback to query ticker ONLY if this is NOT a macro card
        // Macro cards should never inherit portfolio tickers
        ticker = defaultTicker;
      }

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

/**
 * Save research learnings to database (intermediate step)
 */
export async function saveLearnings(
  runId: string,
  learnings: string[],
  urls: string[]
): Promise<void> {
  if (!pool) {
    throw new Error('Database not configured');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create research run if it doesn't exist
    await client.query(
      `INSERT INTO research_runs (run_id, query, depth, breadth, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (run_id) DO UPDATE SET updated_at = CURRENT_TIMESTAMP`,
      [runId, 'Research in progress', 0, 0, 'researching']
    );

    // Delete existing learnings for this run
    await client.query('DELETE FROM research_learnings WHERE run_id = $1', [runId]);

    // Save learnings (URLs are stored separately in report_sources, so we don't need to link them 1:1)
    for (let i = 0; i < learnings.length; i++) {
      await client.query(
        `INSERT INTO research_learnings (run_id, learning, learning_order, source_url)
         VALUES ($1, $2, $3, $4)`,
        [runId, learnings[i], i, null] // URLs are stored separately, not per-learning
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
 * Get research learnings from database
 */
export async function getLearnings(runId: string): Promise<{
  learnings: string[];
  urls: string[];
} | null> {
  if (!pool) return null;

  // Get learnings
  const learningsResult = await pool.query(
    `SELECT learning
     FROM research_learnings
     WHERE run_id = $1
     ORDER BY learning_order`,
    [runId]
  );

  if (learningsResult.rows.length === 0) return null;

  // Get URLs from report_sources
  const urlsResult = await pool.query(
    `SELECT source_url
     FROM report_sources
     WHERE run_id = $1
     ORDER BY source_order`,
    [runId]
  );

  return {
    learnings: learningsResult.rows.map(row => row.learning),
    urls: urlsResult.rows.map(row => row.source_url),
  };
}
