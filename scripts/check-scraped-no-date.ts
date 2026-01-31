/**
 * Run date logic (markdown + URL) on scraped data and list items that do NOT have a date.
 *
 * Reads: test-results/test-step4-scraped-content.json and
 *       research-results/<run>/iteration-<n>/step5-scraped-content.json (if present).
 *
 * Usage:
 *   npx tsx scripts/check-scraped-no-date.ts
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import {
  parseDateFromMarkdown,
  parseDateFromUrl,
} from '../src/parse-date-from-markdown';

interface ScrapedItem {
  url: string;
  markdown?: string;
  reason?: string;
}

async function loadScrapedFiles(): Promise<Array<{ source: string; items: ScrapedItem[] }>> {
  const out: Array<{ source: string; items: ScrapedItem[] }> = [];
  const root = process.cwd();

  // test-results
  const testPath = path.join(root, 'test-results', 'test-step4-scraped-content.json');
  try {
    const raw = await fs.readFile(testPath, 'utf-8');
    const items = JSON.parse(raw) as ScrapedItem[];
    if (Array.isArray(items) && items.length > 0) {
      out.push({ source: testPath, items });
    }
  } catch {
    // ignore
  }

  // research-results/*/iteration-*/step5-scraped-content.json
  const researchDir = path.join(root, 'research-results');
  try {
    const runDirs = await fs.readdir(researchDir, { withFileTypes: true });
    for (const run of runDirs) {
      if (!run.isDirectory() || !run.name.startsWith('research-')) continue;
      const runPath = path.join(researchDir, run.name);
      const iterDirs = await fs.readdir(runPath, { withFileTypes: true }).catch(() => []);
      for (const iter of iterDirs) {
        if (!iter.isDirectory() || !iter.name.startsWith('iteration-')) continue;
        const jsonPath = path.join(runPath, iter.name, 'step5-scraped-content.json');
        try {
          const raw = await fs.readFile(jsonPath, 'utf-8');
          const data = JSON.parse(raw);
          const items = Array.isArray(data) ? data : (data?.scrapedContent ?? []);
          if (items.length > 0) {
            out.push({ source: jsonPath, items });
          }
        } catch {
          // skip
        }
      }
    }
  } catch {
    // research-results may not exist or be readable
  }

  return out;
}

async function main() {
  console.log('🧪 Scraped data: which items do NOT have a date?\n');

  const files = await loadScrapedFiles();
  if (files.length === 0) {
    console.log('No scraped JSON files found (test-results/test-step4-scraped-content.json or research-results/*/iteration-*/step5-scraped-content.json).');
    return;
  }

  let total = 0;
  let withDateMd = 0;
  let withDateUrl = 0;
  let withDateAny = 0;
  const noDate: Array<{ url: string; source: string; preview?: string }> = [];

  for (const { source, items } of files) {
    for (const item of items) {
      if (!item.url) continue;
      const md = item.markdown ?? '';
      const dateMd = md ? parseDateFromMarkdown(md) : null;
      const dateUrl = parseDateFromUrl(item.url);
      const hasAny = !!(dateMd || dateUrl);

      total++;
      if (dateMd) withDateMd++;
      if (dateUrl) withDateUrl++;
      if (hasAny) withDateAny++;

      if (!hasAny) {
        noDate.push({
          url: item.url,
          source,
          preview: md ? md.slice(0, 100).replace(/\n/g, ' ') + '…' : undefined,
        });
      }
    }
  }

  const pct = (n: number) => (total ? ((n / total) * 100).toFixed(1) : '0.0');

  console.log('📊 Totals');
  console.log('   Scraped items:     ', total);
  console.log('   With date (MD):    ', withDateMd, '  ', pct(withDateMd) + '%');
  console.log('   With date (URL):   ', withDateUrl, '  ', pct(withDateUrl) + '%');
  console.log('   With date (either):', withDateAny, '  ', pct(withDateAny) + '%');
  console.log('   WITHOUT date:      ', noDate.length, '  ', pct(noDate.length) + '%');
  console.log('');

  if (noDate.length > 0) {
    console.log('❌ Items with NO date (would be filtered if we drop undated):');
    console.log('');
    for (const x of noDate) {
      console.log('   ' + x.url);
      if (x.preview) console.log('      ' + x.preview);
      console.log('      (' + path.relative(process.cwd(), x.source) + ')');
      console.log('');
    }
  }

  console.log('✅ Done.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
