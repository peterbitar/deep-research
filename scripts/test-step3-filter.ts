// Test Step 3: Batch filter - decide scrape vs metadata
// Tests the smart filtering that groups stories and picks best sources
// Reads results from Step 2

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { filterScrapeNeedsBatched } from '../src/deep-research';
import { CostTracker } from './cost-tracker';
import { getModel } from '../src/ai/providers';

// Load triaged articles from Step 2 results
async function loadStep2Results() {
  const step2Path = path.join(process.cwd(), 'test-results', 'test-step2-triage.xlsx');
  
  try {
    const workbook = XLSX.readFile(step2Path);
    const selectedSheet = workbook.Sheets['Selected'];
    
    if (!selectedSheet) {
      throw new Error('Step 2 results not found. Please run Step 2 first.');
    }
    
    const selectedData = XLSX.utils.sheet_to_json(selectedSheet, { header: 1 }) as any[][];
    
    // Skip header row
    const articles = selectedData.slice(1).map((row) => ({
      url: row[1] || '',
      title: row[2] || '',
      description: row[3] || '',
      snippet: row[3] || '', // Use description as snippet
    })).filter((a) => a.url); // Filter out empty rows
    
    // Also get research goals from Research Goals sheet
    const goalsSheet = workbook.Sheets['Research Goals'];
    const goalsData = goalsSheet ? XLSX.utils.sheet_to_json(goalsSheet, { header: 1 }) as any[][] : [];
    const researchGoals = goalsData.slice(1).map((row) => row[1] || '').filter((g) => g);
    
    // Get original query from Summary sheet
    const summarySheet = workbook.Sheets['Summary'];
    const summaryData = summarySheet ? XLSX.utils.sheet_to_json(summarySheet, { header: 1 }) as any[][] : [];
    const queryRow = summaryData.find((row) => row[0] === 'Query');
    const query = queryRow ? (queryRow[1] || 'What happened with NVIDIA this week?') : 'What happened with NVIDIA this week?';
    
    return { articles, researchGoals, query };
  } catch (error: any) {
    if (error.message.includes('not found') || error.code === 'ENOENT') {
      throw new Error('Step 2 results not found. Please run Step 2 first: npm run tsx scripts/test-step2-triage.ts');
    }
    throw error;
  }
}

async function testStep3Filter() {
  console.log('🧪 Testing Step 3: Batch Filter (Scrape vs Metadata)\n');

  // Load results from Step 2
  console.log('📂 Loading results from Step 2...\n');
  const { articles, researchGoals, query } = await loadStep2Results();

  const costTracker = new CostTracker();

  console.log(`📝 Query: ${query}`);
  console.log(`📰 Input Articles: ${articles.length}\n`);

  // Run batch filter
  console.log('🔍 Running batch filter...\n');
  
  // Estimate LLM call for filtering
  const model = getModel();
  const modelId = (model as any).modelId || 'unknown';
  const filterPromptLength = query.length + researchGoals.join(' ').length + articles.reduce((sum, a) => sum + (a.title?.length || 0) + (a.description?.length || 0), 0) + 1500;
  costTracker.trackLLMCallEstimate(modelId, filterPromptLength, 800, 'filter_scrape_needs');
  
  const { toScrape, metadataOnly } = await filterScrapeNeedsBatched({
    query,
    triagedResults: articles,
    researchGoals,
  });

  // Summary
  const costSummary = costTracker.getSummary();
  console.log('📈 Filter Results:');
  console.log(`  Input articles: ${articles.length}`);
  console.log(`  To scrape: ${toScrape.length}`);
  console.log(`  Metadata-only: ${metadataOnly.length}`);
  console.log(`  Scraping rate: ${((toScrape.length / articles.length) * 100).toFixed(1)}%\n`);
  
  console.log('💰 Cost Summary:');
  console.log(`  Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`  Total time: ${(costSummary.totalTime / 1000).toFixed(1)}s\n`);

  console.log('📥 Articles to Scrape:');
  toScrape.forEach((item, i) => {
    const article = articles.find((a) => a.url === item.url);
    console.log(`  ${i + 1}. ${article?.title || 'Unknown'}`);
    console.log(`     ${item.url}`);
    console.log(`     Reason: ${item.reason}\n`);
  });

  console.log('📄 Metadata-Only Articles:');
  metadataOnly.forEach((item, i) => {
    console.log(`  ${i + 1}. ${item.title || 'Unknown'}`);
    console.log(`     ${item.url}`);
    console.log(`     Reason: ${item.reason}\n`);
  });

  // Export to Excel
  const excelPath = path.join(process.cwd(), 'test-results', 'test-step3-filter.xlsx');
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary
  const estimatedScrapeCost = toScrape.length * 0.075; // $0.075 per scrape
  const summaryData = [
    ['Metric', 'Value'],
    ['Query', query],
    ['Input Articles', articles.length],
    ['To Scrape', toScrape.length],
    ['Metadata-Only', metadataOnly.length],
    ['Scraping Rate', `${((toScrape.length / articles.length) * 100).toFixed(1)}%`],
    ['Cost Savings', `${((metadataOnly.length / articles.length) * 100).toFixed(1)}%`],
    ['', ''],
    ['Cost Summary', ''],
    ['LLM Cost (Filter)', `$${costSummary.totalCost.toFixed(4)}`],
    ['Estimated Scrape Cost', `$${estimatedScrapeCost.toFixed(4)}`],
    ['Total Estimated Cost', `$${(costSummary.totalCost + estimatedScrapeCost).toFixed(4)}`],
    ['Total Time (s)', (costSummary.totalTime / 1000).toFixed(1)],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: To Scrape
  const scrapeData = [
    ['#', 'URL', 'Title', 'Description', 'Reason'],
    ...toScrape.map((item, i) => {
      const article = articles.find((a) => a.url === item.url);
      return [
        i + 1,
        item.url,
        article?.title || 'Unknown',
        article?.description || 'No description',
        item.reason,
      ];
    }),
  ];
  const scrapeSheet = XLSX.utils.aoa_to_sheet(scrapeData);
  XLSX.utils.book_append_sheet(workbook, scrapeSheet, 'To Scrape');

  // Sheet 3: Metadata-Only
  const metadataData = [
    ['#', 'URL', 'Title', 'Description', 'Reason'],
    ...metadataOnly.map((item, i) => [
      i + 1,
      item.url,
      item.title || 'Unknown',
      item.description || 'No description',
      item.reason,
    ]),
  ];
  const metadataSheet = XLSX.utils.aoa_to_sheet(metadataData);
  XLSX.utils.book_append_sheet(workbook, metadataSheet, 'Metadata-Only');

  // Sheet 4: All Articles with Decision
  const allData = [
    ['#', 'URL', 'Title', 'Description', 'Decision', 'Reason'],
    ...articles.map((article, i) => {
      const scrapeItem = toScrape.find((s) => s.url === article.url);
      const metadataItem = metadataOnly.find((m) => m.url === article.url);
      const decision = scrapeItem ? 'SCRAPE' : metadataItem ? 'METADATA' : 'UNKNOWN';
      const reason = scrapeItem?.reason || metadataItem?.reason || 'Not processed';
      return [
        i + 1,
        article.url,
        article.title,
        article.description,
        decision,
        reason,
      ];
    }),
  ];
  const allSheet = XLSX.utils.aoa_to_sheet(allData);
  XLSX.utils.book_append_sheet(workbook, allSheet, 'All Articles');

  // Sheet 5: Cost Details
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
  console.log(`   File size: ${fileSize} bytes\n`);

  return {
    query,
    inputArticles: articles.length,
    toScrape: toScrape.length,
    metadataOnly: metadataOnly.length,
    costSummary,
    excelPath,
  };
}

testStep3Filter()
  .then((result) => {
    console.log('✅ Test complete!');
    console.log(`📊 Excel file: ${result.excelPath}`);
  })
  .catch(console.error);
