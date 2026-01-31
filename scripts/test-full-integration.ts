// Full Integration Test: Complete batched deep research flow
// Tests the entire pipeline from query to final report

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { deepResearch, writeFinalReport } from '../src/deep-research';
import { CostTracker } from './cost-tracker';
import { getModel } from '../src/ai/providers';

async function testFullIntegration() {
  console.log('🧪 Full Integration Test: Batched Deep Research\n');

  const costTracker = new CostTracker();
  const query = 'What happened with NVIDIA this week?';
  const breadth = 4;
  const depth = 2;

  console.log(`📝 Query: ${query}`);
  console.log(`📊 Breadth: ${breadth}`);
  console.log(`🔍 Depth: ${depth}\n`);

  const startTime = Date.now();
  const progressLog: Array<{
    timestamp: string;
    currentDepth: number;
    currentBreadth: number;
    totalQueries: number;
    completedQueries: number;
    currentQuery?: string;
  }> = [];

  // Run deep research
  console.log('🚀 Starting deep research...\n');
  const { learnings, visitedUrls } = await deepResearch({
    query,
    breadth,
    depth,
    onProgress: (progress) => {
      progressLog.push({
        timestamp: new Date().toISOString(),
        ...progress,
      });
      console.log(
        `  Progress: Depth ${progress.currentDepth}/${progress.totalDepth}, ` +
          `Breadth ${progress.currentBreadth}/${progress.totalBreadth}, ` +
          `Queries ${progress.completedQueries}/${progress.totalQueries}`
      );
    },
  });

  const totalTime = Date.now() - startTime;

  // Generate final report
  console.log('\n📝 Generating final report...\n');
  
  // Estimate LLM call for report generation
  const model = getModel();
  const modelId = (model as any).modelId || 'unknown';
  const reportPromptLength = query.length + learnings.join(' ').length + visitedUrls.join(' ').length + 3000;
  const estimatedReportLength = 5000; // Average report length
  costTracker.trackLLMCallEstimate(modelId, reportPromptLength, estimatedReportLength, 'generate_report');
  
  const { reportMarkdown } = await writeFinalReport({
    prompt: query,
    learnings,
    visitedUrls,
  });

  // Save report
  const reportPath = path.join(process.cwd(), 'test-results', 'test-integration-report.md');
  await fs.writeFile(reportPath, reportMarkdown, 'utf-8');

  // Summary
  const costSummary = costTracker.getSummary();
  console.log('📈 Integration Test Results:');
  console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`  Learnings collected: ${learnings.length}`);
  console.log(`  URLs visited: ${visitedUrls.length}`);
  console.log(`  Progress updates: ${progressLog.length}\n`);
  
  console.log('💰 Cost Summary:');
  console.log(`  Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`  Cost by service: ${JSON.stringify(costSummary.costByService, null, 2)}`);
  console.log(`  Cost by operation: ${JSON.stringify(costSummary.costByOperation, null, 2)}`);
  console.log(`  Cost per learning: $${(costSummary.totalCost / learnings.length).toFixed(4)}\n`);

  // Export to Excel
  const excelPath = path.join(process.cwd(), 'test-results', 'test-full-integration.xlsx');
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ['Metric', 'Value'],
    ['Query', query],
    ['Breadth', breadth],
    ['Depth', depth],
    ['Total Time (s)', (totalTime / 1000).toFixed(1)],
    ['Learnings Collected', learnings.length],
    ['URLs Visited', visitedUrls.length],
    ['Progress Updates', progressLog.length],
    ['', ''],
    ['Cost Summary', ''],
    ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
    ['Cost Per Learning', `$${(costSummary.totalCost / learnings.length).toFixed(4)}`],
    ['Cost Per URL', `$${(costSummary.totalCost / visitedUrls.length).toFixed(4)}`],
    ['', ''],
    ['Cost by Service', ''],
    ...Object.entries(costSummary.costByService).map(([service, cost]) => [service, `$${cost.toFixed(4)}`]),
    ['', ''],
    ['Cost by Operation', ''],
    ...Object.entries(costSummary.costByOperation).map(([op, cost]) => [op, `$${cost.toFixed(4)}`]),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: Progress Log
  const progressData = [
    ['Timestamp', 'Current Depth', 'Total Depth', 'Current Breadth', 'Total Breadth', 'Completed Queries', 'Total Queries', 'Current Query'],
    ...progressLog.map((p) => [
      p.timestamp,
      p.currentDepth,
      p.totalDepth,
      p.currentBreadth,
      p.totalBreadth,
      p.completedQueries,
      p.totalQueries,
      p.currentQuery || '',
    ]),
  ];
  const progressSheet = XLSX.utils.aoa_to_sheet(progressData);
  XLSX.utils.book_append_sheet(workbook, progressSheet, 'Progress Log');

  // Sheet 3: Learnings
  const learningsData = [
    ['#', 'Learning', 'Type', 'Length'],
    ...learnings.map((learning, i) => {
      const type = learning.includes('[RECENT CHANGE]')
        ? 'RECENT CHANGE'
        : learning.includes('[LONG-TERM TREND]')
          ? 'LONG-TERM TREND'
          : learning.includes('[CONTEXT]')
            ? 'CONTEXT'
            : learning.includes('[METADATA]')
              ? 'METADATA'
              : 'UNKNOWN';
      return [i + 1, learning, type, learning.length];
    }),
  ];
  const learningsSheet = XLSX.utils.aoa_to_sheet(learningsData);
  XLSX.utils.book_append_sheet(workbook, learningsSheet, 'Learnings');

  // Sheet 4: Visited URLs
  const urlsData = [
    ['#', 'URL', 'Domain'],
    ...visitedUrls.map((url, i) => {
      let domain = '';
      try {
        domain = new URL(url).hostname;
      } catch {
        domain = url;
      }
      return [i + 1, url, domain];
    }),
  ];
  const urlsSheet = XLSX.utils.aoa_to_sheet(urlsData);
  XLSX.utils.book_append_sheet(workbook, urlsSheet, 'Visited URLs');

  // Sheet 5: Report Preview (first 5000 chars)
  const reportPreview = reportMarkdown.substring(0, 5000);
  const reportData = [['Report Content'], [reportPreview]];
  const reportSheet = XLSX.utils.aoa_to_sheet(reportData);
  XLSX.utils.book_append_sheet(workbook, reportSheet, 'Report Preview');

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

  XLSX.writeFile(workbook, excelPath);

  console.log('✅ Integration test complete!');
  console.log(`📊 Excel file: ${path.basename(excelPath)}`);
  console.log(`📝 Report file: ${path.basename(reportPath)}\n`);

  return {
    query,
    breadth,
    depth,
    totalTime,
    learnings: learnings.length,
    visitedUrls: visitedUrls.length,
    excelPath,
    reportPath,
  };
}

testFullIntegration()
  .then((result) => {
    console.log('✅ All tests complete!');
    console.log(`📊 Results: ${result.excelPath}`);
    console.log(`📝 Report: ${result.reportPath}`);
  })
  .catch(console.error);
