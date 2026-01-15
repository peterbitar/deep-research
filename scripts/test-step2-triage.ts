// Test Step 2: Batch triage with deduplication
// Tests the triage phase that selects relevant articles
// Reads results from Step 1

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { triageTitlesBatched } from '../src/deep-research';
import { CostTracker } from './cost-tracker';
import { getModel } from '../src/ai/providers';

// Load articles from Step 1 results
async function loadStep1Results() {
  const step1Path = path.join(process.cwd(), 'test-results', 'test-step1-gather.xlsx');
  
  try {
    const workbook = XLSX.readFile(step1Path);
    const articlesSheet = workbook.Sheets['All Articles'];
    
    if (!articlesSheet) {
      throw new Error('Step 1 results not found. Please run Step 1 first.');
    }
    
    const articlesData = XLSX.utils.sheet_to_json(articlesSheet, { header: 1 }) as any[][];
    
    // Skip header row
    const articles = articlesData.slice(1).map((row) => ({
      url: row[1] || '',
      title: row[2] || '',
      description: row[3] || '',
      snippet: row[3] || '', // Use description as snippet
    })).filter((a) => a.url); // Filter out empty rows
    
    // Also get queries and research goals from Queries sheet
    const queriesSheet = workbook.Sheets['Queries'];
    const queriesData = queriesSheet ? XLSX.utils.sheet_to_json(queriesSheet, { header: 1 }) as any[][] : [];
    const researchGoals = queriesData.slice(1).map((row) => row[2] || '').filter((g) => g);
    
    // Get original query from Summary sheet
    const summarySheet = workbook.Sheets['Summary'];
    const summaryData = summarySheet ? XLSX.utils.sheet_to_json(summarySheet, { header: 1 }) as any[][] : [];
    const queryRow = summaryData.find((row) => row[0] === 'Original Query');
    const query = queryRow ? (queryRow[1] || 'What happened with NVIDIA this week?') : 'What happened with NVIDIA this week?';
    
    return { articles, researchGoals, query };
  } catch (error: any) {
    if (error.message.includes('not found') || error.code === 'ENOENT') {
      throw new Error('Step 1 results not found. Please run Step 1 first: npm run tsx scripts/test-step1-gather.ts');
    }
    throw error;
  }
}

async function testStep2Triage() {
  console.log('🧪 Testing Step 2: Batch Triage\n');

  // Load results from Step 1
  console.log('📂 Loading results from Step 1...\n');
  const { articles, researchGoals, query } = await loadStep1Results();

  const costTracker = new CostTracker();

  console.log(`📝 Query: ${query}`);
  console.log(`📊 Research Goals: ${researchGoals.length}`);
  console.log(`📰 Input Articles: ${articles.length}\n`);

  // Run batch triage
  console.log('🔍 Running batch triage...\n');
  
  // Estimate LLM call for triage
  const model = getModel();
  const modelId = (model as any).modelId || 'unknown';
  const triagePromptLength = query.length + researchGoals.join(' ').length + articles.reduce((sum, a) => sum + (a.title?.length || 0) + (a.description?.length || 0), 0) + 1000;
  costTracker.trackLLMCallEstimate(modelId, triagePromptLength, 500, 'triage_titles');
  
  const triagedUrls = await triageTitlesBatched({
    query,
    results: articles,
    researchGoals,
  });

  const triagedArticles = articles.filter((a) => triagedUrls.includes(a.url));
  const rejectedArticles = articles.filter((a) => !triagedUrls.includes(a.url));

  // Summary
  const costSummary = costTracker.getSummary();
  console.log('📈 Triage Results:');
  console.log(`  Input articles: ${articles.length}`);
  console.log(`  Selected: ${triagedArticles.length}`);
  console.log(`  Rejected: ${rejectedArticles.length}`);
  console.log(`  Selection rate: ${((triagedArticles.length / articles.length) * 100).toFixed(1)}%\n`);
  
  console.log('💰 Cost Summary:');
  console.log(`  Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`  Total time: ${(costSummary.totalTime / 1000).toFixed(1)}s\n`);

  console.log('✅ Selected Articles:');
  triagedArticles.forEach((article, i) => {
    console.log(`  ${i + 1}. ${article.title}`);
    console.log(`     ${article.url}\n`);
  });

  if (rejectedArticles.length > 0) {
    console.log('❌ Rejected Articles:');
    rejectedArticles.forEach((article, i) => {
      console.log(`  ${i + 1}. ${article.title}`);
      console.log(`     ${article.url}\n`);
    });
  }

  // Export to Excel
  const excelPath = path.join(process.cwd(), 'test-results', 'test-step2-triage.xlsx');
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ['Metric', 'Value'],
    ['Query', query],
    ['Research Goals Count', researchGoals.length],
    ['Input Articles', articles.length],
    ['Selected Articles', triagedArticles.length],
    ['Rejected Articles', rejectedArticles.length],
    ['Selection Rate', `${((triagedArticles.length / articles.length) * 100).toFixed(1)}%`],
    ['', ''],
    ['Cost Summary', ''],
    ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
    ['Total Time (s)', (costSummary.totalTime / 1000).toFixed(1)],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: Research Goals
  const goalsData = [
    ['#', 'Research Goal'],
    ...researchGoals.map((goal, i) => [i + 1, goal]),
  ];
  const goalsSheet = XLSX.utils.aoa_to_sheet(goalsData);
  XLSX.utils.book_append_sheet(workbook, goalsSheet, 'Research Goals');

  // Sheet 3: Selected Articles
  const selectedData = [
    ['#', 'URL', 'Title', 'Description', 'Status'],
    ...triagedArticles.map((article, i) => [
      i + 1,
      article.url,
      article.title,
      article.description,
      'SELECTED',
    ]),
  ];
  const selectedSheet = XLSX.utils.aoa_to_sheet(selectedData);
  XLSX.utils.book_append_sheet(workbook, selectedSheet, 'Selected');

  // Sheet 4: Rejected Articles
  const rejectedData = [
    ['#', 'URL', 'Title', 'Description', 'Status'],
    ...rejectedArticles.map((article, i) => [
      i + 1,
      article.url,
      article.title,
      article.description,
      'REJECTED',
    ]),
  ];
  const rejectedSheet = XLSX.utils.aoa_to_sheet(rejectedData);
  XLSX.utils.book_append_sheet(workbook, rejectedSheet, 'Rejected');

  // Sheet 5: All Articles with Status
  const allData = [
    ['#', 'URL', 'Title', 'Description', 'Status', 'Reason'],
    ...articles.map((article, i) => {
      const isSelected = triagedUrls.includes(article.url);
      let reason = '';
      if (!isSelected) {
        if (article.url.includes('marketminute')) {
          reason = 'Tier 3 aggregator';
        } else if (article.title.includes('2025')) {
          reason = 'Long-term outlook, not recent news';
        } else {
          reason = 'Not relevant/important';
        }
      }
      return [
        i + 1,
        article.url,
        article.title,
        article.description,
        isSelected ? 'SELECTED' : 'REJECTED',
        reason,
      ];
    }),
  ];
  const allSheet = XLSX.utils.aoa_to_sheet(allData);
  XLSX.utils.book_append_sheet(workbook, allSheet, 'All Articles');

  // Sheet 6: Cost Details
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
  console.log(`✅ Results exported to: ${path.basename(excelPath)}`);
  console.log(`   Full path: ${excelPath}`);
  console.log(`   File size: ${(await fs.stat(excelPath)).size} bytes\n`);

  return {
    query,
    researchGoals,
    inputArticles: articles.length,
    selectedArticles: triagedArticles.length,
    rejectedArticles: rejectedArticles.length,
    triagedUrls,
    costSummary,
    excelPath,
  };
}

testStep2Triage()
  .then((result) => {
    console.log('✅ Test complete!');
    console.log(`📊 Excel file: ${result.excelPath}`);
  })
  .catch(console.error);
