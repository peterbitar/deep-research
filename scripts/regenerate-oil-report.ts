// Regenerate Step 7 Report for Oil using existing test results

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import { writeFinalReport } from '../src/deep-research';
import { CostTracker } from './cost-tracker';
import { getModel } from '../src/ai/providers';

async function regenerateOilReport() {
  console.log('📝 Regenerating Oil Report (Step 7)\n');

  const costTracker = new CostTracker();
  const resultsDir = path.join(process.cwd(), 'test-results');

  // Load Step 6 results
  console.log('📂 Loading results from Step 6...\n');
  const step6Path = path.join(resultsDir, 'test-oil-step6-process.xlsx');
  const workbook = XLSX.readFile(step6Path);
  const sheet = workbook.Sheets['Step 6 Process'];
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[];

  // Extract learnings
  const learnings: string[] = [];
  let inLearningsSection = false;
  for (const row of data) {
    if (Array.isArray(row) && row.length > 0) {
      if (row[0] === 'Learnings') {
        inLearningsSection = true;
        continue;
      }
      if (inLearningsSection && row[0] && typeof row[0] === 'number') {
        if (row[1] && typeof row[1] === 'string') {
          learnings.push(row[1]);
        }
      }
      if (inLearningsSection && row[0] === '') {
        break;
      }
    }
  }

  // Get query
  const query = data.find(row => Array.isArray(row) && row[0] === 'Query')?.[1] || 'What happened with oil this week?';

  // Load Step 4 results to get URLs
  console.log('📂 Loading URLs from Step 4...\n');
  const step4Path = path.join(resultsDir, 'test-oil-step4-filter.xlsx');
  const workbook4 = XLSX.readFile(step4Path);
  const sheet4 = workbook4.Sheets['Step 4 Filter'];
  const data4 = XLSX.utils.sheet_to_json(sheet4, { header: 1 }) as any[];

  const visitedUrls: string[] = [];
  let inToScrapeSection = false;
  let inMetadataSection = false;
  for (const row of data4) {
    if (Array.isArray(row) && row.length > 0) {
      if (row[0] === 'To Scrape') {
        inToScrapeSection = true;
        inMetadataSection = false;
        continue;
      }
      if (row[0] === 'Metadata Only') {
        inToScrapeSection = false;
        inMetadataSection = true;
        continue;
      }
      if ((inToScrapeSection || inMetadataSection) && row[1] && typeof row[1] === 'string' && row[1].startsWith('http')) {
        visitedUrls.push(row[1]);
      }
    }
  }

  console.log(`📝 Query: ${query}`);
  console.log(`📚 Learnings: ${learnings.length}`);
  console.log(`🔗 URLs: ${visitedUrls.length}\n`);

  // Generate report
  console.log('📝 Generating final report...\n');

  const model = getModel();
  const modelId = (model as any).modelId || 'unknown';
  const reportPromptLength = query.length + learnings.join(' ').length + visitedUrls.join(' ').length + 3000;
  const estimatedReportLength = 5000;
  costTracker.trackLLMCallEstimate(modelId, reportPromptLength, estimatedReportLength, 'generate_report');

  const report = await writeFinalReport({
    prompt: query,
    learnings,
    visitedUrls,
  });

  // Save report
  const reportPath = path.join(resultsDir, 'test-oil-step7-report.md');
  await fs.writeFile(reportPath, report, 'utf-8');

  const reportStats = {
    length: report.length,
    lines: report.split('\n').length,
    learningsUsed: learnings.length,
    urlsIncluded: visitedUrls.length,
  };

  console.log('📈 Report Generation Results:');
  console.log(`  Report length: ${reportStats.length} characters`);
  console.log(`  Report lines: ${reportStats.lines}`);
  console.log(`  Learnings used: ${reportStats.learningsUsed}`);
  console.log(`  URLs included: ${reportStats.urlsIncluded}\n`);

  const costSummary = costTracker.getSummary();
  console.log('💰 Cost Summary:');
  console.log(`  Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`  Total time: ${(Date.now() - Date.now()) / 1000}s\n`);

  // Save summary to Excel
  const step7Data = [
    ['Query', query],
    ['Report Length', reportStats.length],
    ['Report Lines', reportStats.lines],
    ['Learnings Used', reportStats.learningsUsed],
    ['URLs Included', reportStats.urlsIncluded],
    ['', ''],
    ['Cost Summary', ''],
    ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
    ['', ''],
    ['Report Preview (first 1000 chars)', ''],
    [report.substring(0, 1000)],
  ];

  const step7Workbook = XLSX.utils.book_new();
  const step7Sheet = XLSX.utils.aoa_to_sheet(step7Data);
  XLSX.utils.book_append_sheet(step7Workbook, step7Sheet, 'Step 7 Report');
  const step7ExcelPath = path.join(resultsDir, 'test-oil-step7-report.xlsx');
  XLSX.writeFile(step7Workbook, step7ExcelPath);

  console.log('✅ Report saved to: test-oil-step7-report.md');
  console.log(`   Full path: ${reportPath}`);
  console.log(`   File size: ${(await fs.stat(reportPath)).size} bytes\n`);

  console.log('✅ Summary exported to: test-oil-step7-report.xlsx');
  console.log(`   Full path: ${step7ExcelPath}`);
  console.log(`   File size: ${(await fs.stat(step7ExcelPath)).size} bytes\n`);

  console.log('📄 Report Preview (first 500 chars):\n');
  console.log(report.substring(0, 500) + '...\n');

  console.log('✅ Test complete!');
  console.log(`📝 Report: ${reportPath}`);
  console.log(`📊 Excel summary: ${step7ExcelPath}`);
}

regenerateOilReport().catch(console.error);
