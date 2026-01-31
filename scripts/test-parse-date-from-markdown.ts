/**
 * Test parseDateFromMarkdown on already-scraped content (no dates previously extracted).
 * Reports success rate and per-URL results.
 *
 * Usage:
 *   npx tsx scripts/test-parse-date-from-markdown.ts [path-to-scraped-content.json]
 * Default: test-results/test-step4-scraped-content.json
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { parseDateFromMarkdown } from '../src/parse-date-from-markdown';

interface ScrapedItem {
  url: string;
  markdown: string;
  reason?: string;
}

async function main() {
  const inputPath =
    process.argv[2] ||
    path.join(process.cwd(), 'test-results', 'test-step4-scraped-content.json');

  console.log('🧪 Test: parseDateFromMarkdown on scraped content (no dates)\n');
  console.log(`📂 Input: ${inputPath}\n`);

  let raw: string;
  try {
    raw = await fs.readFile(inputPath, 'utf-8');
  } catch (e: any) {
    if (e.code === 'ENOENT') {
      console.error('File not found. Run test-step4-scrape first or pass a path to a scraped-content JSON.');
      process.exit(1);
    }
    throw e;
  }

  let items: ScrapedItem[];
  try {
    const parsed = JSON.parse(raw);
    items = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    console.error('Invalid JSON.');
    process.exit(1);
  }

  const withMarkdown = items.filter((i) => i.markdown && i.markdown.trim().length > 0);
  if (withMarkdown.length === 0) {
    console.log('No items with markdown to test.');
    return;
  }

  const results: Array<{ url: string; date: string | null; preview?: string }> = [];
  for (const item of withMarkdown) {
    const date = parseDateFromMarkdown(item.markdown);
    const preview = item.markdown.slice(0, 120).replace(/\n/g, ' ');
    results.push({ url: item.url, date, preview });
  }

  const success = results.filter((r) => r.date !== null);
  const failed = results.filter((r) => r.date === null);
  const successRate = (success.length / results.length) * 100;

  console.log('📊 Results\n');
  console.log(`  Total items (with markdown): ${results.length}`);
  console.log(`  Date parsed:                 ${success.length}`);
  console.log(`  No date found:               ${failed.length}`);
  console.log(`  Success rate:                ${successRate.toFixed(1)}%\n`);

  console.log('✅ With date:');
  for (const r of success) {
    console.log(`   ${r.date}  ${r.url}`);
  }

  console.log('\n❌ No date:');
  for (const r of failed) {
    console.log(`   ${r.url}`);
    if (r.preview) console.log(`      Preview: ${r.preview}...`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
