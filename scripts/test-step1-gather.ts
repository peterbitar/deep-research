// Test Step 1: Gathering search results from multiple queries
// Tests the search gathering phase with deduplication

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import FirecrawlApp from '@mendable/firecrawl-js';
import { generateSerpQueries, retryFirecrawlSearch } from '../src/deep-research';
import { CostTracker } from './cost-tracker';
import { getModel } from '../src/ai/providers';

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY || '',
  baseURL: process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
});

async function testStep1Gather() {
  console.log('🧪 Testing Step 1: Gathering Search Results\n');

  const costTracker = new CostTracker();
  const query = 'What happened with NVIDIA this week?';
  const breadth = 4;

  // Step 1: Generate queries
  console.log(`📝 Generating ${breadth} search queries...`);
  const model = getModel();
  const modelId = (model as any).modelId || 'unknown';
  
  // Estimate LLM call for query generation
  const queryPromptLength = query.length + 500; // Base prompt + query
  costTracker.trackLLMCallEstimate(modelId, queryPromptLength, 1000, 'generate_queries');
  
  const serpQueries = await generateSerpQueries({
    query,
    numQueries: breadth,
  });

  console.log(`✅ Generated ${serpQueries.length} queries:\n`);
  serpQueries.forEach((q, i) => {
    console.log(`  ${i + 1}. ${q.query}`);
    console.log(`     Goal: ${q.researchGoal}\n`);
  });

  // Step 2: Search all queries
  console.log(`🔍 Searching ${serpQueries.length} queries...\n`);
  
  // Track Firecrawl search costs
  costTracker.trackFirecrawlSearch(serpQueries.length);
  
  const allSearchResults = await Promise.all(
    serpQueries.map(async (serpQuery) => {
      try {
        const searchResult = await retryFirecrawlSearch(
          () =>
            firecrawl.search(serpQuery.query, {
              timeout: 15000,
              limit: 30,
            }),
          serpQuery.query
        );

        return {
          query: serpQuery.query,
          researchGoal: serpQuery.researchGoal,
          results: searchResult.data.map((item) => ({
            url: item.url,
            title: (item as any).title || (item as any).metadata?.title || 'No title',
            description: (item as any).description || (item as any).snippet || 'No description',
            snippet: (item as any).snippet,
          })),
        };
      } catch (e: any) {
        console.error(`❌ Error searching "${serpQuery.query}":`, e.message);
        return {
          query: serpQuery.query,
          researchGoal: serpQuery.researchGoal,
          results: [],
        };
      }
    })
  );

  // Step 3: Deduplicate by URL
  console.log(`📊 Deduplicating results...\n`);
  const urlMap = new Map<
    string,
    {
      url: string;
      title: string;
      description: string;
      snippet: string;
      sourceQueries: string[];
      researchGoals: string[];
    }
  >();

  for (const searchResult of allSearchResults) {
    for (const article of searchResult.results) {
      if (urlMap.has(article.url)) {
        const existing = urlMap.get(article.url)!;
        if (!existing.sourceQueries.includes(searchResult.query)) {
          existing.sourceQueries.push(searchResult.query);
        }
        if (!existing.researchGoals.includes(searchResult.researchGoal)) {
          existing.researchGoals.push(searchResult.researchGoal);
        }
      } else {
        urlMap.set(article.url, {
          url: article.url,
          title: article.title,
          description: article.description,
          snippet: article.snippet,
          sourceQueries: [searchResult.query],
          researchGoals: [searchResult.researchGoal],
        });
      }
    }
  }

  const allArticles = Array.from(urlMap.values());
  const totalBeforeDedup = allSearchResults.reduce((sum, r) => sum + r.results.length, 0);

  // Summary
  const costSummary = costTracker.getSummary();
  console.log('📈 Results Summary:');
  console.log(`  Total results before dedup: ${totalBeforeDedup}`);
  console.log(`  Unique articles after dedup: ${allArticles.length}`);
  console.log(`  Duplicates removed: ${totalBeforeDedup - allArticles.length}`);
  console.log(`  Deduplication rate: ${((totalBeforeDedup - allArticles.length) / totalBeforeDedup * 100).toFixed(1)}%\n`);
  
  console.log('💰 Cost Summary:');
  console.log(`  Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`  By service: ${JSON.stringify(costSummary.costByService, null, 2)}`);
  console.log(`  By operation: ${JSON.stringify(costSummary.costByOperation, null, 2)}`);
  console.log(`  Total time: ${(costSummary.totalTime / 1000).toFixed(1)}s\n`);

  // Export to Excel
  const excelPath = path.join(process.cwd(), 'test-results', 'test-step1-gather.xlsx');

  // Create workbook with multiple sheets
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ['Metric', 'Value'],
    ['Original Query', query],
    ['Number of Queries', serpQueries.length],
    ['Total Results (Before Dedup)', totalBeforeDedup],
    ['Unique Articles (After Dedup)', allArticles.length],
    ['Duplicates Removed', totalBeforeDedup - allArticles.length],
    ['Deduplication Rate', `${((totalBeforeDedup - allArticles.length) / totalBeforeDedup * 100).toFixed(1)}%`],
    ['', ''],
    ['Cost Summary', ''],
    ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
    ['Total Time (s)', (costSummary.totalTime / 1000).toFixed(1)],
    ['', ''],
    ['Cost by Service', ''],
    ...Object.entries(costSummary.costByService).map(([service, cost]) => [service, `$${cost.toFixed(4)}`]),
    ['', ''],
    ['Cost by Operation', ''],
    ...Object.entries(costSummary.costByOperation).map(([op, cost]) => [op, `$${cost.toFixed(4)}`]),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: Queries
  const queriesData = [
    ['#', 'Query', 'Research Goal', 'Results Count'],
    ...serpQueries.map((q, i) => [
      i + 1,
      q.query,
      q.researchGoal,
      allSearchResults[i]?.results.length || 0,
    ]),
  ];
  const queriesSheet = XLSX.utils.aoa_to_sheet(queriesData);
  XLSX.utils.book_append_sheet(workbook, queriesSheet, 'Queries');

  // Sheet 3: All Articles
  const articlesData = [
    [
      '#',
      'URL',
      'Title',
      'Description',
      'Source Queries',
      'Research Goals',
      'Appears in N Queries',
    ],
    ...allArticles.map((article, i) => [
      i + 1,
      article.url,
      article.title,
      article.description,
      article.sourceQueries.join('; '),
      article.researchGoals.join('; '),
      article.sourceQueries.length,
    ]),
  ];
  const articlesSheet = XLSX.utils.aoa_to_sheet(articlesData);
  XLSX.utils.book_append_sheet(workbook, articlesSheet, 'All Articles');

  // Sheet 4: Duplicates Analysis
  const duplicates = allArticles.filter((a) => a.sourceQueries.length > 1);
  const duplicatesData = [
    ['#', 'URL', 'Title', 'Appears in Queries', 'Query Count'],
    ...duplicates.map((article, i) => [
      i + 1,
      article.url,
      article.title,
      article.sourceQueries.join('; '),
      article.sourceQueries.length,
    ]),
  ];
  const duplicatesSheet = XLSX.utils.aoa_to_sheet(duplicatesData);
  XLSX.utils.book_append_sheet(workbook, duplicatesSheet, 'Duplicates');

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

  // Write file
  XLSX.writeFile(workbook, excelPath);
  console.log(`✅ Results exported to: ${path.basename(excelPath)}\n`);

  return {
    query,
    serpQueries,
    allSearchResults,
    allArticles,
    totalBeforeDedup,
    duplicatesRemoved: totalBeforeDedup - allArticles.length,
    costSummary,
    excelPath,
  };
}

testStep1Gather()
  .then((result) => {
    console.log('✅ Test complete!');
    console.log(`📊 Excel file: ${result.excelPath}`);
  })
  .catch(console.error);
