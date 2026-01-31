/**
 * Replace the latest report's cards manually (no LLM).
 *
 * Usage:
 *   npx tsx scripts/replace-cards-manually.ts [path-to-cards.json]
 *
 * - If no path is given, uses scripts/manual-cards.json.
 * - If the cards file does not exist: exports current report cards to that file
 *   and exits. Edit the file and run again to replace.
 * - If the cards file exists: replaces the latest report's cards in the DB
 *   with the cards from the file.
 *
 * JSON format (array of cards):
 *   [
 *     { "title": "...", "content": "...", "emoji": "📌", "ticker": "NFLX", "macro": null },
 *     ...
 *   ]
 * emoji, ticker, and macro are optional.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { pool } from '../src/db/client';
import {
  getLatestReport,
  getReportCards,
  saveReport,
} from '../src/db/reports';
import { parseReportToCards } from '../src/report-parser';

interface ManualCard {
  title: string;
  content: string;
  emoji?: string;
  ticker?: string;
  macro?: string;
}

function buildReportMarkdown(
  opening: string,
  cards: ManualCard[],
  sources: string[]
): string {
  const cardBlocks = cards.map(
    (c) =>
      `## ${c.emoji ? c.emoji + ' ' : ''}${c.title}\n\n${c.content || ''}`
  );
  const sourcesBlock =
    sources.length > 0
      ? `\n\n## Sources\n\n${sources.map((s) => `- ${s}`).join('\n')}`
      : '';
  return `${opening}\n\n${cardBlocks.join('\n\n')}${sourcesBlock}`;
}

async function main() {
  const cardsPath =
    process.argv[2] ||
    path.join(process.cwd(), 'scripts', 'manual-cards.json');

  console.log('🔄 Replace cards manually\n');

  if (!process.env.DATABASE_URL || !pool) {
    throw new Error('DATABASE_URL is required and pool must be initialized.');
  }

  const fileExists = await fs.access(cardsPath).then(
    () => true,
    () => false
  );

  if (!fileExists) {
    // Export current report cards to the file
    const latest = await getReportCards();
    if (!latest) {
      throw new Error('No report found in DB. Run generate-report or full pipeline first.');
    }
    const manualCards: ManualCard[] = latest.cards.map((c) => ({
      title: c.title,
      content: c.content,
      emoji: c.emoji ?? undefined,
      ticker: c.ticker ?? undefined,
      macro: c.macro ?? undefined,
    }));
    await fs.mkdir(path.dirname(cardsPath), { recursive: true }).catch(() => {});
    await fs.writeFile(
      cardsPath,
      JSON.stringify(manualCards, null, 2),
      'utf-8'
    );
    console.log(`📄 Created ${cardsPath} from current report (${manualCards.length} cards).`);
    console.log('   Edit the file and run this script again to replace cards in the DB.\n');
    return;
  }

  // Read manual cards and replace in DB
  const raw = await fs.readFile(cardsPath, 'utf-8');
  let cards: ManualCard[];
  try {
    cards = JSON.parse(raw) as ManualCard[];
  } catch (e) {
    throw new Error(`Invalid JSON in ${cardsPath}: ${(e as Error).message}`);
  }
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('Cards file must be a non-empty array of { title, content, emoji?, ticker?, macro? }.');
  }

  const report = await getLatestReport();
  if (!report) {
    throw new Error('No report found in DB.');
  }

  const parsed = parseReportToCards(report.reportMarkdown);
  const newMarkdown = buildReportMarkdown(parsed.opening, cards, parsed.sources);
  const cardMetadata = cards.map((c) => ({
    ticker: c.ticker ?? undefined,
    macro: c.macro ?? undefined,
  }));

  const runResult = await pool!.query(
    `SELECT query, depth, breadth FROM research_runs WHERE run_id = $1`,
    [report.runId]
  );
  const row = runResult.rows[0];
  if (!row) {
    throw new Error(`Research run not found: ${report.runId}`);
  }

  await saveReport({
    runId: report.runId,
    query: row.query,
    depth: row.depth ?? 3,
    breadth: row.breadth ?? 3,
    reportMarkdown: newMarkdown,
    sources: parsed.sources,
    cardMetadata,
  });

  console.log(`✅ Replaced cards for run ${report.runId} with ${cards.length} cards from ${path.basename(cardsPath)}.`);
  console.log('   Use /api/report/cards to serve the app.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
