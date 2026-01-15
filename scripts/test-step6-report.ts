// Test Step 6: Generate final report
// Tests the report generation phase that creates the final markdown report
// Reads results from Step 5

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { writeFinalReport } from '../src/deep-research';
import { CostTracker } from './cost-tracker';
import { getModel } from '../src/ai/providers';

// Load learnings and URLs from Step 5 results
async function loadStep5Results() {
  const step5Path = path.join(process.cwd(), 'test-results', 'test-step5-process.xlsx');
  
  try {
    const workbook = XLSX.readFile(step5Path);
    
    // Get query from Summary sheet
    const summarySheet = workbook.Sheets['Summary'];
    const summaryData = summarySheet ? XLSX.utils.sheet_to_json(summarySheet, { header: 1 }) as any[][] : [];
    const queryRow = summaryData.find((row) => row[0] === 'Query');
    const query = queryRow ? (queryRow[1] || 'What happened with NVIDIA this week?') : 'What happened with NVIDIA this week?';
    
    // Get learnings from Learnings sheet
    const learningsSheet = workbook.Sheets['Learnings'];
    const learningsData = learningsSheet ? XLSX.utils.sheet_to_json(learningsSheet, { header: 1 }) as any[][] : [];
    const learnings = learningsData.slice(1).map((row) => row[1] || '').filter((l) => l);
    
    // Get URLs from Input Articles sheet
    const articlesSheet = workbook.Sheets['Input Articles'];
    const articlesData = articlesSheet ? XLSX.utils.sheet_to_json(articlesSheet, { header: 1 }) as any[][] : [];
    const visitedUrls = articlesData.slice(1).map((row) => row[1] || '').filter((url) => url);
    
    return { query, learnings, visitedUrls };
  } catch (error: any) {
    if (error.message.includes('not found') || error.code === 'ENOENT') {
      throw new Error('Step 5 results not found. Please run Step 5 first: npm run tsx scripts/test-step5-process.ts');
    }
    throw error;
  }
}

async function testStep6Report() {
  console.log('🧪 Testing Step 6: Generate Final Report\n');

  // Load results from Step 5
  console.log('📂 Loading results from Step 5...\n');
  const { query, learnings, visitedUrls } = await loadStep5Results();

  const costTracker = new CostTracker();

  console.log(`📝 Query: ${query}`);
  console.log(`📚 Learnings: ${learnings.length}`);
  console.log(`🔗 URLs: ${visitedUrls.length}\n`);

  // Generate final report
  console.log('📝 Generating final report...\n');
  
  // Estimate LLM call for report generation
  const model = getModel();
  const modelId = (model as any).modelId || 'unknown';
  const reportPromptLength = query.length + learnings.join(' ').length + visitedUrls.join(' ').length + 3000;
  const estimatedReportLength = 5000; // Average report length
  costTracker.trackLLMCallEstimate(modelId, reportPromptLength, estimatedReportLength, 'generate_report');
  
  const report = await writeFinalReport({
    prompt: query,
    learnings,
    visitedUrls,
  });

  // Summary
  const costSummary = costTracker.getSummary();
  console.log('📈 Report Generation Results:');
  console.log(`  Report length: ${report.length} characters`);
  console.log(`  Report lines: ${report.split('\n').length}`);
  console.log(`  Learnings used: ${learnings.length}`);
  console.log(`  URLs included: ${visitedUrls.length}\n`);
  
  console.log('💰 Cost Summary:');
  console.log(`  Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`  Total time: ${(costSummary.totalTime / 1000).toFixed(1)}s\n`);

  // Save report to markdown file
  const reportPath = path.join(process.cwd(), 'test-results', 'test-step6-report.md');
  await fs.writeFile(reportPath, report, 'utf-8');
  
  console.log(`✅ Report saved to: ${path.basename(reportPath)}`);
  console.log(`   Full path: ${reportPath}`);
  console.log(`   File size: ${(await fs.stat(reportPath)).size} bytes\n`);

  // Also export summary to Excel for tracking
  const excelPath = path.join(process.cwd(), 'test-results', 'test-step6-report.xlsx');
  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ['Metric', 'Value'],
    ['Query', query],
    ['Learnings Used', learnings.length],
    ['URLs Included', visitedUrls.length],
    ['Report Length (chars)', report.length],
    ['Report Lines', report.split('\n').length],
    ['', ''],
    ['Cost Summary', ''],
    ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
    ['Total Time (s)', (costSummary.totalTime / 1000).toFixed(1)],
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: Learnings Used
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
  XLSX.utils.book_append_sheet(workbook, learningsSheet, 'Learnings Used');

  // Sheet 3: URLs Included
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
  XLSX.utils.book_append_sheet(workbook, urlsSheet, 'URLs Included');

  // Sheet 4: Cost Details
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

  // Sheet 5: Report Preview (first 5000 chars)
  const reportPreview = report.substring(0, 5000);
  const reportPreviewData = [['Report Preview (First 5000 chars)'], [reportPreview]];
  const reportPreviewSheet = XLSX.utils.aoa_to_sheet(reportPreviewData);
  XLSX.utils.book_append_sheet(workbook, reportPreviewSheet, 'Report Preview');

  // Ensure directory exists
  const dir = path.dirname(excelPath);
  await fs.mkdir(dir, { recursive: true });
  
  // Write Excel file
  XLSX.writeFile(workbook, excelPath);
  const excelSize = (await fs.stat(excelPath)).size;
  console.log(`✅ Summary exported to: ${path.basename(excelPath)}`);
  console.log(`   Full path: ${excelPath}`);
  console.log(`   File size: ${excelSize} bytes\n`);

  // Show report preview
  console.log('📄 Report Preview (first 500 chars):\n');
  console.log(report.substring(0, 500) + '...\n');

  return {
    query,
    learnings: learnings.length,
    visitedUrls: visitedUrls.length,
    reportLength: report.length,
    costSummary,
    reportPath,
    excelPath,
  };
}

testStep6Report()
  .then((result) => {
    console.log('✅ Test complete!');
    console.log(`📝 Report: ${result.reportPath}`);
    console.log(`📊 Excel summary: ${result.excelPath}`);
  })
  .catch(console.error);
