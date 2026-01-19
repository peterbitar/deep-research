// Script to migrate latest report from filesystem to database
import * as fs from 'fs/promises';
import * as path from 'path';
import { pool, initializeSchema } from '../src/db/client';

// Copy parseReportToCards function to avoid importing api.ts (which starts Express server)
function parseReportToCards(reportMarkdown: string): {
  opening: string;
  cards: Array<{ title: string; content: string; emoji?: string }>;
  sources: string[];
} {
  const sourcesRegex = /^##\s+Sources\s*$/m;
  const sourcesMatch = reportMarkdown.match(sourcesRegex);
  const sourcesIndex = sourcesMatch ? sourcesMatch.index! : reportMarkdown.length;
  
  const mainContent = reportMarkdown.substring(0, sourcesIndex).trim();
  const sourcesSection = sourcesMatch 
    ? reportMarkdown.substring(sourcesIndex).trim()
    : '';
  
  const sources: string[] = [];
  if (sourcesSection) {
    const sourceLines = sourcesSection.split('\n').slice(1);
    for (const line of sourceLines) {
      const match = line.match(/^-\s*(.+)$/);
      if (match) {
        sources.push(match[1].trim());
      }
    }
  }
  
  const cardHeaders: Array<{ index: number; emoji?: string; title: string }> = [];
  let match;
  
  const headerRegexWithHash = /^##\s*([^\s]+)?\s*(.+)$/gm;
  while ((match = headerRegexWithHash.exec(mainContent)) !== null) {
    const emoji = match[1] && /[\p{Emoji}]/u.test(match[1]) ? match[1] : undefined;
    const title = emoji ? match[2].trim() : (match[1] || match[2]).trim();
    cardHeaders.push({
      index: match.index!,
      emoji,
      title,
    });
  }
  
  if (cardHeaders.length === 0) {
    const headerRegexWithoutHash = /^([\p{Emoji}])\s+(.+)$/gmu;
    while ((match = headerRegexWithoutHash.exec(mainContent)) !== null) {
      cardHeaders.push({
        index: match.index!,
        emoji: match[1],
        title: match[2].trim(),
      });
    }
  }
  
  const opening = cardHeaders.length > 0
    ? mainContent.substring(0, cardHeaders[0].index).trim()
    : mainContent.trim();
  
  const cards: Array<{ title: string; content: string; emoji?: string }> = [];
  for (let i = 0; i < cardHeaders.length; i++) {
    const startIndex = cardHeaders[i].index;
    const endIndex = i < cardHeaders.length - 1
      ? cardHeaders[i + 1].index
      : mainContent.length;
    
    const cardContent = mainContent.substring(startIndex, endIndex).trim();
    const contentLines = cardContent.split('\n');
    const content = contentLines.slice(1).join('\n').trim();
    
    cards.push({
      title: cardHeaders[i].title,
      content,
      emoji: cardHeaders[i].emoji,
    });
  }
  
  return { opening, cards, sources };
}

async function migrateLatestReport() {
  console.log('🔄 Migrating latest report to database...\n');

  // Check if DATABASE_URL is set
  if (!process.env.DATABASE_URL) {
    console.error('❌ DATABASE_URL not set. Please set it in your environment.');
    process.exit(1);
  }

  // Initialize database schema first
  console.log('📋 Initializing database schema...\n');
  await initializeSchema();

  try {
    // Find latest report directory
    const researchResultsDir = path.join(process.cwd(), 'research-results');
    
    const entries = await fs.readdir(researchResultsDir, { withFileTypes: true });
    const directories = entries
      .filter(entry => entry.isDirectory() && entry.name.startsWith('research-'))
      .map(entry => entry.name)
      .sort()
      .reverse();

    if (directories.length === 0) {
      console.error('❌ No research reports found in research-results/');
      process.exit(1);
    }

    const latestDir = directories[0];
    const reportPath = path.join(researchResultsDir, latestDir, 'final-report.md');

    console.log(`📄 Found latest report: ${latestDir}`);
    console.log(`📁 Path: ${reportPath}\n`);

    // Read report
    const reportMarkdown = await fs.readFile(reportPath, 'utf-8');
    console.log(`✅ Read report (${reportMarkdown.length} characters)\n`);

    // Parse report
    const parsed = parseReportToCards(reportMarkdown);
    console.log(`📊 Parsed report:`);
    console.log(`   - Opening: ${parsed.opening.length} chars`);
    console.log(`   - Cards: ${parsed.cards.length}`);
    console.log(`   - Sources: ${parsed.sources.length}\n`);

    // Extract timestamp from run ID
    const timestampStr = latestDir.replace('research-', '');
    const timestamp = parseInt(timestampStr, 10);
    
    // Generate a query description (you can customize this)
    const query = `Migrated report from filesystem - ${latestDir}`;

    // Save to database directly (avoiding api.ts import)
    console.log('💾 Saving to database...\n');
    
    if (!pool) {
      console.error('❌ Database pool not initialized. Check DATABASE_URL.');
      process.exit(1);
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
        [latestDir, query, 3, 3, 'completed']
      );

      // Save report
      await client.query(
        `INSERT INTO reports (run_id, report_markdown, opening)
         VALUES ($1, $2, $3)
         ON CONFLICT (run_id) DO UPDATE SET
           report_markdown = EXCLUDED.report_markdown,
           opening = EXCLUDED.opening,
           updated_at = CURRENT_TIMESTAMP`,
        [latestDir, reportMarkdown, parsed.opening]
      );

      // Delete existing cards and sources
      await client.query('DELETE FROM report_cards WHERE run_id = $1', [latestDir]);
      await client.query('DELETE FROM report_sources WHERE run_id = $1', [latestDir]);

      // Save cards
      for (let i = 0; i < parsed.cards.length; i++) {
        const card = parsed.cards[i];
        const ticker = card.title.match(/\b(AAPL|NVDA|TSLA|MSFT|GOOGL|XRP|BTC|ETH)\b/i)?.[0]?.toUpperCase() || null;
        const macro = card.title.match(/\b(Fed|ECB|Central Bank|Economic|Geopolitical)\b/i)?.[0] || null;

        await client.query(
          `INSERT INTO report_cards (run_id, title, content, emoji, ticker, macro, card_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [latestDir, card.title, card.content, card.emoji || null, ticker, macro, i]
        );
      }

      // Save sources
      for (let i = 0; i < parsed.sources.length; i++) {
        await client.query(
          `INSERT INTO report_sources (run_id, source_url, source_order)
           VALUES ($1, $2, $3)`,
          [latestDir, parsed.sources[i], i]
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    console.log('✅ Successfully migrated report to database!');
    console.log(`   Run ID: ${latestDir}`);
    console.log(`   Cards: ${parsed.cards.length}`);
    console.log(`   Sources: ${parsed.sources.length}\n`);
    console.log('🎉 Your iOS app can now fetch this report from the database!');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

migrateLatestReport().catch(console.error);
