// Test Step 4: Scraping articles
// Tests the scraping phase for selected articles
// Reads results from Step 3

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import FirecrawlApp from '@mendable/firecrawl-js';
import { retryFirecrawlSearch } from '../src/deep-research';
import { CostTracker } from './cost-tracker';

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY || '',
  baseURL: process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
});

// Load URLs to scrape from Step 3 results
async function loadStep3Results() {
  const step3Path = path.join(process.cwd(), 'test-results', 'test-step3-filter.xlsx');
  
  try {
    const workbook = XLSX.readFile(step3Path);
    const scrapeSheet = workbook.Sheets['To Scrape'];
    
    if (!scrapeSheet) {
      throw new Error('Step 3 results not found. Please run Step 3 first.');
    }
    
    const scrapeData = XLSX.utils.sheet_to_json(scrapeSheet, { header: 1 }) as any[][];
    
    // Skip header row
    const urlsToScrape = scrapeData.slice(1).map((row) => ({
      url: row[1] || '',
      reason: row[4] || 'No reason provided',
    })).filter((item) => item.url); // Filter out empty rows
    
    return urlsToScrape;
  } catch (error: any) {
    if (error.message.includes('not found') || error.code === 'ENOENT') {
      throw new Error('Step 3 results not found. Please run Step 3 first: npm run tsx scripts/test-step3-filter.ts');
    }
    throw error;
  }
}

async function testStep4Scrape() {
  console.log('🧪 Testing Step 4: Scraping Articles\n');

  // Load results from Step 3
  console.log('📂 Loading results from Step 3...\n');
  const urlsToScrape = await loadStep3Results();

  const costTracker = new CostTracker();
  console.log(`📥 Articles to scrape: ${urlsToScrape.length}\n`);

  // Track scraping costs
  costTracker.trackFirecrawlScrape(urlsToScrape.length);

  const scrapeResults: Array<{
    url: string;
    reason: string;
    success: boolean;
    markdown?: string;
    markdownLength?: number;
    error?: string;
    timeMs?: number;
  }> = [];

  // Scrape each article
  for (const item of urlsToScrape) {
    console.log(`🔍 Scraping: ${item.url}`);
    const startTime = Date.now();

    try {
      const scraped = await retryFirecrawlSearch(
        async () => {
          // Firecrawl scrape method - try different possible method names
          if (typeof (firecrawl as any).scrapeUrl === 'function') {
            return await (firecrawl as any).scrapeUrl(item.url, { formats: ['markdown'] });
          } else if (typeof (firecrawl as any).scrape === 'function') {
            return await (firecrawl as any).scrape(item.url, { formats: ['markdown'] });
          } else {
            // Fallback: use search with scrapeOptions for single URL
            const result = await firecrawl.search(`site:${new URL(item.url).hostname} ${item.url}`, {
              limit: 1,
              scrapeOptions: { formats: ['markdown'] },
            });
            return result.data[0] || { url: item.url, markdown: '' };
          }
        },
        item.url
      );

      const markdown =
        scraped?.markdown ||
        scraped?.data?.markdown ||
        scraped?.content?.markdown ||
        (typeof scraped === 'string' ? scraped : '');

      const timeMs = Date.now() - startTime;

      scrapeResults.push({
        url: item.url,
        reason: item.reason,
        success: true,
        markdown: markdown,
        markdownLength: markdown.length,
        timeMs,
      });

      console.log(`  ✅ Success (${markdown.length} chars, ${timeMs}ms)\n`);
    } catch (error: any) {
      const timeMs = Date.now() - startTime;
      scrapeResults.push({
        url: item.url,
        reason: item.reason,
        success: false,
        error: error.message || String(error),
        timeMs,
      });

      console.log(`  ❌ Error: ${error.message || error}\n`);
    }
  }

  // Summary
  const costSummary = costTracker.getSummary();
  const successful = scrapeResults.filter((r) => r.success).length;
  const failed = scrapeResults.filter((r) => !r.success).length;
  const totalChars = scrapeResults.reduce((sum, r) => sum + (r.markdownLength || 0), 0);
  const avgTime = scrapeResults.reduce((sum, r) => sum + (r.timeMs || 0), 0) / scrapeResults.length;

  console.log('📈 Scraping Results:');
  console.log(`  Total articles: ${scrapeResults.length}`);
  console.log(`  Successful: ${successful}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Success rate: ${((successful / scrapeResults.length) * 100).toFixed(1)}%`);
  console.log(`  Total content: ${totalChars.toLocaleString()} characters`);
  console.log(`  Average time: ${avgTime.toFixed(0)}ms\n`);
  
  console.log('💰 Cost Summary:');
  console.log(`  Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`  Cost per article: $${(costSummary.totalCost / scrapeResults.length).toFixed(4)}`);
  console.log(`  Total time: ${(costSummary.totalTime / 1000).toFixed(1)}s\n`);

  // Export to Excel
  const excelPath = path.join(process.cwd(), 'test-results', 'test-step4-scrape.xlsx');
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ['Metric', 'Value'],
    ['Total Articles', scrapeResults.length],
    ['Successful', successful],
    ['Failed', failed],
    ['Success Rate', `${((successful / scrapeResults.length) * 100).toFixed(1)}%`],
    ['Total Content (chars)', totalChars],
    ['Average Time (ms)', avgTime.toFixed(0)],
    ['', ''],
    ['Cost Summary', ''],
    ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
    ['Cost Per Article', `$${(costSummary.totalCost / scrapeResults.length).toFixed(4)}`],
    ['Total Time (s)', (costSummary.totalTime / 1000).toFixed(1)],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: Scrape Results
  const resultsData = [
    ['#', 'URL', 'Reason', 'Status', 'Content Length', 'Time (ms)', 'Error'],
    ...scrapeResults.map((result, i) => [
      i + 1,
      result.url,
      result.reason,
      result.success ? 'SUCCESS' : 'FAILED',
      result.markdownLength || 0,
      result.timeMs || 0,
      result.error || '',
    ]),
  ];
  const resultsSheet = XLSX.utils.aoa_to_sheet(resultsData);
  XLSX.utils.book_append_sheet(workbook, resultsSheet, 'Scrape Results');

  // Save scraped content to JSON file (for Step 5)
  // Excel has 32,767 character limit per cell, so we store in JSON
  const contentPath = path.join(process.cwd(), 'test-results', 'test-step4-scraped-content.json');
  const scrapedContent = scrapeResults
    .filter((r) => r.success && r.markdown)
    .map((result) => ({
      url: result.url,
      markdown: result.markdown,
      reason: result.reason,
    }));
  
  await fs.writeFile(contentPath, JSON.stringify(scrapedContent, null, 2), 'utf-8');
  console.log(`   Scraped content saved to: test-step4-scraped-content.json`);

  // Sheet 3: Cost Details
  const costData = [
    ['#', 'Service', 'Operation', 'Count', 'Cost Per Unit', 'Total Cost', 'Metadata'],
    ...costSummary.costs.map((cost, i) => [
      i + 1,
      cost.service,
      cost.operation,
      cost.count,
      `$${cost.costPerUnit.toFixed(4)}`,
      `$${cost.totalCost.toFixed(4)}`,
      JSON.stringify(cost.metadata || {}),
    ]),
  ];
  const costSheet = XLSX.utils.aoa_to_sheet(costData);
  XLSX.utils.book_append_sheet(workbook, costSheet, 'Cost Details');

  // Ensure directory exists
  const dir = path.dirname(excelPath);
  await fs.mkdir(dir, { recursive: true });
  
  // Write file
  XLSX.writeFile(workbook, excelPath);
  const fileSize = (await fs.stat(excelPath)).size;
  console.log(`✅ Results exported to: ${path.basename(excelPath)}`);
  console.log(`   Full path: ${excelPath}`);
  console.log(`   File size: ${fileSize} bytes`);
  console.log(`   Scraped content saved for Step 5\n`);

  return {
    totalArticles: scrapeResults.length,
    successful,
    failed,
    totalChars,
    costSummary,
    excelPath,
  };
}

testStep4Scrape()
  .then((result) => {
    console.log('✅ Test complete!');
    console.log(`📊 Excel file: ${result.excelPath}`);
  })
  .catch(console.error);
