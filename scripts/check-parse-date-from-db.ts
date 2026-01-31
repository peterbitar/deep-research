/**
 * Check all reports in DB and try multiple date-extraction approaches:
 * - Markdown: parseDateFromMarkdown (report_markdown or card content)
 * - URL: parseDateFromUrl on report_sources (reports only; cards have no URL)
 * - Combined: markdown OR URL for reports
 *
 * Usage:
 *   npx tsx --env-file=.env.local scripts/check-parse-date-from-db.ts
 */

import { pool } from '../src/db/client';
import {
  parseDateFromMarkdown,
  parseDateFromUrl,
} from '../src/parse-date-from-markdown';

async function main() {
  console.log('🧪 Parse date from DB: compare approaches (markdown vs URL vs combined)\n');

  if (!process.env.DATABASE_URL || !pool) {
    throw new Error('DATABASE_URL required and pool must be initialized.');
  }

  const reportsResult = await pool.query(
    `SELECT run_id, report_markdown, created_at FROM reports ORDER BY created_at DESC`
  );
  const reports = reportsResult.rows as Array<{
    run_id: string;
    report_markdown: string;
    created_at: Date;
  }>;

  const cardsResult = await pool.query(
    `SELECT run_id, title, content, card_order FROM report_cards ORDER BY run_id, card_order`
  );
  const cards = cardsResult.rows as Array<{
    run_id: string;
    title: string;
    content: string;
    card_order: number;
  }>;

  const sourcesResult = await pool.query(
    `SELECT run_id, source_url FROM report_sources ORDER BY run_id, source_order`
  );
  const sourcesByRun = new Map<string, string[]>();
  for (const row of sourcesResult.rows as Array<{ run_id: string; source_url: string }>) {
    const list = sourcesByRun.get(row.run_id) ?? [];
    list.push(row.source_url);
    sourcesByRun.set(row.run_id, list);
  }

  console.log(`📊 Loaded ${reports.length} report(s), ${cards.length} card(s), ${sourcesResult.rows.length} source URL(s)\n`);

  // --- Reports: markdown only ---
  let reportMarkdownOnly = 0;
  const reportFromMarkdown: Array<{ run_id: string; date: string | null }> = [];
  for (const r of reports) {
    const date = r.report_markdown ? parseDateFromMarkdown(r.report_markdown) : null;
    if (date) reportMarkdownOnly++;
    reportFromMarkdown.push({ run_id: r.run_id, date });
  }

  // --- Reports: URL only (from report_sources) ---
  let reportUrlOnly = 0;
  const reportFromUrl: Array<{ run_id: string; date: string | null }> = [];
  for (const r of reports) {
    const urls = sourcesByRun.get(r.run_id) ?? [];
    let date: string | null = null;
    for (const url of urls) {
      const d = parseDateFromUrl(url);
      if (d) {
        date = d;
        break;
      }
    }
    if (date) reportUrlOnly++;
    reportFromUrl.push({ run_id: r.run_id, date });
  }

  // --- Reports: combined (markdown OR URL) ---
  let reportCombined = 0;
  for (let i = 0; i < reports.length; i++) {
    const fromMd = reportFromMarkdown[i].date;
    const fromUrl = reportFromUrl[i].date;
    if (fromMd || fromUrl) reportCombined++;
  }

  // --- Cards: markdown only (no URL per card in DB) ---
  let cardMarkdownOnly = 0;
  const cardFromMarkdown: Array<{ run_id: string; title: string; date: string | null }> = [];
  for (const c of cards) {
    const date = c.content ? parseDateFromMarkdown(c.content) : null;
    if (date) cardMarkdownOnly++;
    cardFromMarkdown.push({ run_id: c.run_id, title: c.title.slice(0, 50), date });
  }

  const nReports = reports.length;
  const nCards = cards.length;
  const rate = (n: number, total: number) =>
    total ? ((n / total) * 100).toFixed(1) : '0.0';

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUCCESS RATE BY APPROACH');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('  REPORTS (total: ' + nReports + ')');
  console.log('  ───────────────────────────────────────────────────────');
  console.log('    Markdown only:  ' + reportMarkdownOnly + ' / ' + nReports + '  = ' + rate(reportMarkdownOnly, nReports) + '%');
  console.log('    URL only:       ' + reportUrlOnly + ' / ' + nReports + '  = ' + rate(reportUrlOnly, nReports) + '%');
  console.log('    Combined (MD or URL): ' + reportCombined + ' / ' + nReports + '  = ' + rate(reportCombined, nReports) + '%\n');

  console.log('  CARDS (total: ' + nCards + ')');
  console.log('  ───────────────────────────────────────────────────────');
  console.log('    Markdown only:  ' + cardMarkdownOnly + ' / ' + nCards + '  = ' + rate(cardMarkdownOnly, nCards) + '%');
  console.log('    (No URL per card in DB; combined = markdown only)\n');

  console.log('═══════════════════════════════════════════════════════════');
  console.log('  SUMMARY: Best approach');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log('  Reports: Use COMBINED (markdown + URL). ' + rate(reportCombined, nReports) + '% success.');
  console.log('  Cards:   Use markdown only. ' + rate(cardMarkdownOnly, nCards) + '% success.\n');

  // Optional: list reports with date from URL but not markdown (shows URL value-add)
  const urlAdds = reportFromMarkdown
    .map((r, i) => ({ run_id: r.run_id, md: r.date, url: reportFromUrl[i].date }))
    .filter((x) => !x.md && x.url);
  if (urlAdds.length > 0) {
    console.log('  Reports where URL provided date but markdown did not: ' + urlAdds.length);
    urlAdds.slice(0, 10).forEach((x) => console.log('    ' + x.url + '  ' + x.run_id));
    if (urlAdds.length > 10) console.log('    ... and ' + (urlAdds.length - 10) + ' more');
    console.log('');
  }

  console.log('✅ Done.');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
