// Database functions for reports and cards
import { pool } from './client';
import { parseReportToCards } from '../report-parser';

export interface ReportCard {
  title: string;
  content: string;
  emoji?: string;
  ticker?: string;
  macro?: string;
  eventType?: string;
  card_order: number;
}

export interface ReportData {
  runId: string;
  query: string;
  depth: number;
  breadth: number;
  reportMarkdown: string;
  sources: string[];
  /** Optional: per-card ticker/macro/eventType from pipeline. When present, used instead of inferring from title/content. */
  cardMetadata?: Array<{ ticker?: string; macro?: string; eventType?: string }>;
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

    // Dynamic ticker extraction from query
    const queryUpper = data.query.toUpperCase();
    
    // Common company name to ticker mappings
    const COMPANY_NAME_MAP: Record<string, string> = {
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
      'BLACKBERRY': 'BB',
      'LIGHTSPEED': 'LSPD',
    };
    
    // Extract ticker from query - check company names first, then ticker pattern
    let defaultTicker: string | null = null;
    
    // Check for company names
    for (const [companyName, ticker] of Object.entries(COMPANY_NAME_MAP)) {
      if (queryUpper.includes(companyName)) {
        defaultTicker = ticker;
        break;
      }
    }
    
    // If no company name found, try ticker pattern (1-5 uppercase letters)
    if (!defaultTicker) {
      const tickerMatch = queryUpper.match(/\b([A-Z]{2,5})(?![A-Za-z])/);
      if (tickerMatch) {
        const potentialTicker = tickerMatch[1];
        // Only use if it's a known ticker or looks valid (2-5 chars, not common words)
        const commonWords = new Set(['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO']);
        if (!commonWords.has(potentialTicker)) {
          defaultTicker = potentialTicker;
        }
      }
    }

    // Save cards (use pipeline tag when available, else infer from title/content)
    for (let i = 0; i < parsed.cards.length; i++) {
      const card = parsed.cards[i];
      const meta = data.cardMetadata?.[i];
      let ticker: string | null = null;
      let macro: string | null = null;
      let eventType: string | null = null;

      if (meta) {
        ticker = meta.ticker ?? null;
        macro = meta.macro ?? null;
        eventType = meta.eventType ?? null;
      }

      if (ticker === null && macro === null) {
        // Fallback: infer from card title/content (legacy path)
        const cardTitleUpper = card.title.toUpperCase();
        const cardContentUpper = card.content.toUpperCase();
        macro = card.title.match(/\b(Fed|ECB|Central Bank|Economic|Geopolitical)\b/i)?.[0] || null;
        const cardText = `${cardTitleUpper} ${cardContentUpper}`;
        for (const [companyName, mappedTicker] of Object.entries(COMPANY_NAME_MAP)) {
          if (cardText.includes(companyName)) {
            ticker = mappedTicker;
            break;
          }
        }
        if (!ticker) {
          const tickerPattern = /\b([A-Z]{2,5})(?![A-Za-z])/g;
          const commonWords = new Set(['THE', 'AND', 'FOR', 'ARE', 'BUT', 'NOT', 'YOU', 'ALL', 'CAN', 'HER', 'WAS', 'ONE', 'OUR', 'OUT', 'DAY', 'GET', 'HAS', 'HIM', 'HIS', 'HOW', 'ITS', 'MAY', 'NEW', 'NOW', 'OLD', 'SEE', 'TWO', 'WHO']);
          let match;
          while ((match = tickerPattern.exec(cardText)) !== null) {
            const symbol = match[1];
            if (symbol.length >= 2 && !commonWords.has(symbol)) {
              ticker = symbol;
              break;
            }
          }
        }
        if (!ticker && defaultTicker && !macro) ticker = defaultTicker;
      }

      await client.query(
        `INSERT INTO report_cards (run_id, title, content, emoji, ticker, macro, event_type, card_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [data.runId, card.title, card.content, card.emoji || null, ticker, macro, eventType, i]
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
    `SELECT title, content, emoji, ticker, macro, event_type, card_order
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
      eventType: row.event_type ?? undefined,
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
  urls: string[],
  holdings?: string[] // Optional: list of holdings that were researched
): Promise<void> {
  if (!pool) {
    throw new Error('Database not configured');
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Build query string that includes holdings info if available
    let queryText = 'Research in progress';
    if (holdings && holdings.length > 0) {
      // Store holdings in query field as JSON for easy extraction
      // Format: "Research in progress | HOLDINGS: SYMBOL1,SYMBOL2,SYMBOL3"
      queryText = `Research in progress | HOLDINGS: ${holdings.join(',')}`;
    }

    // Create research run if it doesn't exist
    await client.query(
      `INSERT INTO research_runs (run_id, query, depth, breadth, status)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (run_id) DO UPDATE SET 
         query = EXCLUDED.query,
         updated_at = CURRENT_TIMESTAMP`,
      [runId, queryText, 0, 0, 'researching']
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

/** Ensure news_brief_holdings table exists (for DBs created before this table was added). */
async function ensureNewsBriefHoldingsTable(): Promise<void> {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS news_brief_holdings (
      run_id VARCHAR(255) NOT NULL,
      symbol VARCHAR(20) NOT NULL,
      status VARCHAR(50) NOT NULL DEFAULT 'completed',
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (run_id, symbol)
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS idx_news_brief_holdings_run_id ON news_brief_holdings(run_id)`
  );
}

/**
 * Create or ensure a news-brief run exists (status in_progress). Call at start of run.
 * Also creates a placeholder reports row so the app can show this run and cards as they are appended.
 */
export async function ensureNewsBriefRun(
  runId: string,
  queryText: string
): Promise<void> {
  if (!pool) throw new Error('Database not configured');
  await ensureNewsBriefHoldingsTable();
  await pool.query(
    `INSERT INTO research_runs (run_id, query, depth, breadth, status)
     VALUES ($1, $2, 0, 0, 'in_progress')
     ON CONFLICT (run_id) DO UPDATE SET
       query = EXCLUDED.query,
       status = 'in_progress',
       updated_at = CURRENT_TIMESTAMP`,
    [runId, queryText]
  );
  await pool.query(
    `INSERT INTO reports (run_id, report_markdown, opening)
     VALUES ($1, 'Report in progress.', '')
     ON CONFLICT (run_id) DO NOTHING`,
    [runId]
  );
}

/**
 * Append a single card for a run so the app can show it immediately.
 * Call after each card is generated; saveReport at the end will replace all cards with the final set.
 */
export async function appendCardToReport(
  runId: string,
  card: { title: string; content: string; emoji?: string; eventType?: string },
  cardOrder: number,
  ticker?: string | null,
  macro?: string | null
): Promise<void> {
  if (!pool) throw new Error('Database not configured');
  await pool.query(
    `INSERT INTO report_cards (run_id, title, content, emoji, ticker, macro, event_type, card_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      runId,
      card.title,
      card.content,
      card.emoji ?? null,
      ticker ?? null,
      macro ?? null,
      card.eventType ?? null,
      cardOrder,
    ]
  );
}

/**
 * Append learnings for one holding and mark that holding complete. Call after each holding E2E.
 */
export async function appendLearningsForHolding(
  runId: string,
  symbol: string,
  learnings: string[],
  urls: string[],
  learningOrderStart: number
): Promise<void> {
  if (!pool) throw new Error('Database not configured');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (let i = 0; i < learnings.length; i++) {
      await client.query(
        `INSERT INTO research_learnings (run_id, learning, learning_order, source_url)
         VALUES ($1, $2, $3, $4)`,
        [runId, learnings[i], learningOrderStart + i, null]
      );
    }
    const urlOrderRes = await client.query(
      `SELECT COALESCE(MAX(source_order), -1) + 1 AS next_order FROM report_sources WHERE run_id = $1`,
      [runId]
    );
    const urlOrderStart = (urlOrderRes.rows[0]?.next_order as number) ?? 0;
    const uniqueUrls = [...new Set(urls)];
    for (let i = 0; i < uniqueUrls.length; i++) {
      await client.query(
        `INSERT INTO report_sources (run_id, source_url, source_order) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
        [runId, uniqueUrls[i], urlOrderStart + i]
      );
    }
    await client.query(
      `INSERT INTO news_brief_holdings (run_id, symbol, status) VALUES ($1, $2, 'completed')
       ON CONFLICT (run_id, symbol) DO UPDATE SET status = 'completed', created_at = CURRENT_TIMESTAMP`,
      [runId, symbol]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
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
