// Test Step 5: Processing and summarizing
// Tests the final processing phase that extracts learnings
// Reads results from Step 4

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { processSerpResult } from '../src/deep-research';
import type { SearchResponse } from '@mendable/firecrawl-js';
import { CostTracker } from './cost-tracker';
import { getModel } from '../src/ai/providers';

// Load scraped content from Step 4 and metadata-only from Step 3
async function loadStep4And3Results() {
  // Load scraped content from Step 4 (JSON file)
  const contentPath = path.join(process.cwd(), 'test-results', 'test-step4-scraped-content.json');
  const step3Path = path.join(process.cwd(), 'test-results', 'test-step3-filter.xlsx');
  
  try {
    // Load Step 4 scraped content from JSON
    const contentJson = await fs.readFile(contentPath, 'utf-8');
    const scrapedArticles = JSON.parse(contentJson) as Array<{ url: string; markdown: string; reason?: string }>;
    
    // Load Step 3 metadata-only articles
    const step3Workbook = XLSX.readFile(step3Path);
    const metadataSheet = step3Workbook.Sheets['Metadata-Only'];
    
    const metadataArticles: Array<{ url: string; markdown: string }> = [];
    if (metadataSheet) {
      const metadataData = XLSX.utils.sheet_to_json(metadataSheet, { header: 1 }) as any[][];
      metadataArticles.push(...metadataData.slice(1).map((row) => ({
        url: row[1] || '',
        markdown: `Title: ${row[2] || 'No title'}\n\nDescription: ${row[3] || 'No description'}\n\n[Metadata only - not fully scraped. Reason: ${row[4] || 'N/A'}]`,
      })).filter((a) => a.url));
    }
    
    // Get query from Step 3 summary
    const summarySheet = step3Workbook.Sheets['Summary'];
    const summaryData = summarySheet ? XLSX.utils.sheet_to_json(summarySheet, { header: 1 }) as any[][] : [];
    const queryRow = summaryData.find((row) => row[0] === 'Query');
    const query = queryRow ? (queryRow[1] || 'What happened with NVIDIA this week?') : 'What happened with NVIDIA this week?';
    
    // Combine scraped + metadata into SearchResponse format
    const combinedResults: SearchResponse = {
      data: [
        ...scrapedArticles.map((a) => ({
          url: a.url,
          markdown: a.markdown,
        })),
        ...metadataArticles.map((a) => ({
          url: a.url,
          markdown: a.markdown,
        })),
      ],
    };
    
    return { results: combinedResults, query };
  } catch (error: any) {
    if (error.message.includes('not found') || error.code === 'ENOENT') {
      throw new Error('Step 4 or Step 3 results not found. Please run Steps 3 and 4 first.');
    }
    throw error;
  }
}

async function testStep5Process() {
  console.log('🧪 Testing Step 5: Processing and Summarizing\n');

  // Load results from Steps 4 and 3
  console.log('📂 Loading results from Steps 4 and 3...\n');
  const { results, query } = await loadStep4And3Results();

  const costTracker = new CostTracker();
  const numLearnings = 5;
  const numFollowUpQuestions = 3;

  console.log(`📝 Query: ${query}`);
  console.log(`📰 Input Articles: ${results.data.length}`);
  console.log(`   - Scraped: ${results.data.filter((a) => !a.markdown?.includes('[Metadata only')).length}`);
  console.log(`   - Metadata-only: ${results.data.filter((a) => a.markdown?.includes('[Metadata only')).length}`);
  console.log(`🎯 Target Learnings: ${numLearnings}`);
  console.log(`❓ Target Follow-up Questions: ${numFollowUpQuestions}\n`);

  // Process results
  console.log('🔍 Processing articles to extract learnings...\n');
  
  // Estimate LLM call for processing
  const model = getModel();
  const modelId = (model as any).modelId || 'unknown';
  const processPromptLength = query.length + results.data.reduce((sum, item) => sum + (item.markdown?.length || 0), 0) + 2000;
  const estimatedOutputLength = numLearnings * 200 + numFollowUpQuestions * 100;
  costTracker.trackLLMCallEstimate(modelId, processPromptLength, estimatedOutputLength, 'process_results');
  
  const result = await processSerpResult({
    query,
    result: results,
    numLearnings,
    numFollowUpQuestions,
  });

  // Summary
  const costSummary = costTracker.getSummary();
  console.log('📈 Processing Results:');
  console.log(`  Learnings extracted: ${result.learnings.length}`);
  console.log(`  Follow-up questions: ${result.followUpQuestions.length}\n`);
  
  console.log('💰 Cost Summary:');
  console.log(`  Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`  Total time: ${(costSummary.totalTime / 1000).toFixed(1)}s\n`);

  console.log('📚 Learnings:');
  result.learnings.forEach((learning, i) => {
    console.log(`  ${i + 1}. ${learning}\n`);
  });

  console.log('❓ Follow-up Questions:');
  result.followUpQuestions.forEach((question, i) => {
    console.log(`  ${i + 1}. ${question}\n`);
  });

  // Export to Excel
  const excelPath = path.join(process.cwd(), 'test-results', 'test-step5-process.xlsx');
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ['Metric', 'Value'],
    ['Query', query],
    ['Input Articles', results.data.length],
    ['Learnings Extracted', result.learnings.length],
    ['Follow-up Questions', result.followUpQuestions.length],
    ['', ''],
    ['Cost Summary', ''],
    ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
    ['Total Time (s)', (costSummary.totalTime / 1000).toFixed(1)],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: Learnings
  const learningsData = [
    ['#', 'Learning', 'Type', 'Length'],
    ...result.learnings.map((learning, i) => {
      const type = learning.includes('[RECENT CHANGE]')
        ? 'RECENT CHANGE'
        : learning.includes('[LONG-TERM TREND]')
          ? 'LONG-TERM TREND'
          : learning.includes('[CONTEXT]')
            ? 'CONTEXT'
            : 'UNKNOWN';
      return [i + 1, learning, type, learning.length];
    }),
  ];
  const learningsSheet = XLSX.utils.aoa_to_sheet(learningsData);
  XLSX.utils.book_append_sheet(workbook, learningsSheet, 'Learnings');

  // Sheet 3: Follow-up Questions
  const questionsData = [
    ['#', 'Question', 'Length'],
    ...result.followUpQuestions.map((question, i) => [i + 1, question, question.length]),
  ];
  const questionsSheet = XLSX.utils.aoa_to_sheet(questionsData);
  XLSX.utils.book_append_sheet(workbook, questionsSheet, 'Follow-up Questions');

  // Sheet 4: Input Articles
  const articlesData = [
    ['#', 'URL', 'Content Type', 'Content Length'],
    ...results.data.map((item, i) => {
      const isMetadata = item.markdown?.includes('[Metadata only') || false;
      return [
        i + 1,
        item.url,
        isMetadata ? 'Metadata' : 'Full Content',
        item.markdown?.length || 0,
      ];
    }),
  ];
  const articlesSheet = XLSX.utils.aoa_to_sheet(articlesData);
  XLSX.utils.book_append_sheet(workbook, articlesSheet, 'Input Articles');

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
    inputArticles: results.data.length,
    learnings: result.learnings.length,
    followUpQuestions: result.followUpQuestions.length,
    costSummary,
    excelPath,
  };
}

testStep5Process()
  .then((result) => {
    console.log('✅ Test complete!');
    console.log(`📊 Excel file: ${result.excelPath}`);
  })
  .catch(console.error);
