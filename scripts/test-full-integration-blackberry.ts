// Full Integration Test for BlackBerry: Complete batched deep research flow with step-by-step saving
// Tests the entire pipeline from query to final report and saves all intermediate steps

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import {
  generateSerpQueries,
  triageTitlesBatched,
  filterScrapeNeedsBatched,
  processSerpResult,
  writeFinalReport,
} from '../src/deep-research';
import { CostTracker } from './cost-tracker';
import { getModel } from '../src/ai/providers';
import FirecrawlApp from '@mendable/firecrawl-js';

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY ?? '',
  apiUrl: process.env.FIRECRAWL_BASE_URL,
});

async function testFullIntegrationBlackberry() {
  console.log('🧪 Full Integration Test: BlackBerry Research with Step-by-Step Saving\n');

  const costTracker = new CostTracker();
  const query = 'What happened with BlackBerry this week?';
  const breadth = 4;
  const depth = 2;

  console.log(`📝 Query: ${query}`);
  console.log(`📊 Breadth: ${breadth}`);
  console.log(`🔍 Depth: ${depth}\n`);

  const resultsDir = path.join(process.cwd(), 'test-results');
  await fs.mkdir(resultsDir, { recursive: true });

  const allStepResults: any = {
    query,
    breadth,
    depth,
    steps: [],
  };

  // STEP 1: Generate SERP Queries
  console.log('📋 Step 1: Generating SERP queries...\n');
  const startTime = Date.now();
  const model = getModel();
  const modelId = (model as any).modelId || 'unknown';

  const serpQueries = await generateSerpQueries({
    query,
    numQueries: breadth,
    learnings: [],
  });

  const queryPromptLength = query.length + 500;
  const estimatedQueryLength = serpQueries.map(q => q.query).join(' ').length;
  costTracker.trackLLMCallEstimate(modelId, queryPromptLength, estimatedQueryLength, 'generate_serp_queries');

  console.log(`✅ Generated ${serpQueries.length} queries:`);
  serpQueries.forEach((q, i) => console.log(`  ${i + 1}. ${q.query}`));
  console.log('');

  // STEP 2: Gather Search Results
  console.log('🔍 Step 2: Gathering search results...\n');
  const allSearchResults: Array<{ url: string; title?: string; description?: string; snippet?: string }> = [];
  const urlSet = new Set<string>();

  for (let i = 0; i < serpQueries.length; i++) {
    const serpQuery = serpQueries[i];
    const searchQuery = serpQuery.query;
    console.log(`  Searching: "${searchQuery}" (${i + 1}/${serpQueries.length})...`);

    try {
      const searchResponse = await firecrawl.search(searchQuery, {
        timeout: 15000,
        limit: 30,
      });

      costTracker.trackFirecrawlSearch(searchResponse.data?.length || 0);

      if (searchResponse.data) {
        for (const result of searchResponse.data) {
          if (result.url && !urlSet.has(result.url)) {
            urlSet.add(result.url);
            allSearchResults.push({
              url: result.url,
              title: result.title,
              description: result.description,
              snippet: result.snippet,
            });
          }
        }
      }
    } catch (error: any) {
      console.error(`  ⚠️  Error searching "${searchQuery}": ${error.message}`);
    }
  }

  console.log(`✅ Gathered ${allSearchResults.length} unique articles\n`);

  // Save Step 1 & 2 results
  const step1_2Data = [
    ['Query', query],
    ['Breadth', breadth],
    ['SERP Queries', ''],
    ...serpQueries.map((q, i) => ['', `${i + 1}. ${q.query}`]),
    ['', ''],
    ['Search Results', ''],
    ['Total Unique Articles', allSearchResults.length],
    ['', ''],
    ['Articles', ''],
    ['#', 'URL', 'Title', 'Description'],
    ...allSearchResults.map((r, i) => [
      i + 1,
      r.url,
      r.title || '',
      r.description || r.snippet || '',
    ]),
  ];

  const step1_2Workbook = XLSX.utils.book_new();
  const step1_2Sheet = XLSX.utils.aoa_to_sheet(step1_2Data);
  XLSX.utils.book_append_sheet(step1_2Workbook, step1_2Sheet, 'Step 1-2 Results');
  const step1_2Path = path.join(resultsDir, 'test-blackberry-step1-2-gather.xlsx');
  XLSX.writeFile(step1_2Workbook, step1_2Path);
  console.log(`💾 Saved Step 1-2 results to: ${path.basename(step1_2Path)}\n`);

  // STEP 3: Batch Triage
  console.log('🎯 Step 3: Batch triage...\n');
  const researchGoals: string[] = [];
  const triagedUrls = await triageTitlesBatched({
    query,
    results: allSearchResults,
    researchGoals,
  });

  const triagePromptLength = query.length + allSearchResults.map(r => `${r.title} ${r.description}`).join(' ').length + 2000;
  const estimatedTriageLength = triagedUrls.length * 100;
  costTracker.trackLLMCallEstimate(modelId, triagePromptLength, estimatedTriageLength, 'triage_titles_batched');

  const triagedResults = allSearchResults.filter(r => triagedUrls.includes(r.url));
  console.log(`✅ Selected ${triagedResults.length} articles from ${allSearchResults.length} total\n`);

  // Save Step 3 results
  const step3Data = [
    ['Query', query],
    ['Total Articles', allSearchResults.length],
    ['Selected Articles', triagedResults.length],
    ['', ''],
    ['Selected Articles', ''],
    ['#', 'URL', 'Title', 'Description'],
    ...triagedResults.map((r, i) => [
      i + 1,
      r.url,
      r.title || '',
      r.description || r.snippet || '',
    ]),
  ];

  const step3Workbook = XLSX.utils.book_new();
  const step3Sheet = XLSX.utils.aoa_to_sheet(step3Data);
  XLSX.utils.book_append_sheet(step3Workbook, step3Sheet, 'Step 3 Triage');
  const step3Path = path.join(resultsDir, 'test-blackberry-step3-triage.xlsx');
  XLSX.writeFile(step3Workbook, step3Path);
  console.log(`💾 Saved Step 3 results to: ${path.basename(step3Path)}\n`);

  // STEP 4: Filter Scrape Needs
  console.log('🔍 Step 4: Filter scrape needs...\n');
  const { toScrape, metadataOnly } = await filterScrapeNeedsBatched({
    query,
    triagedResults,
    researchGoals,
  });

  const filterPromptLength = query.length + triagedResults.map(r => `${r.title} ${r.description}`).join(' ').length + 2000;
  const estimatedFilterLength = (toScrape.length + metadataOnly.length) * 100;
  costTracker.trackLLMCallEstimate(modelId, filterPromptLength, estimatedFilterLength, 'filter_scrape_needs_batched');

  console.log(`✅ To scrape: ${toScrape.length}, Metadata only: ${metadataOnly.length}\n`);

  // Save Step 4 results
  const step4Data = [
    ['Query', query],
    ['Total Triaged', triagedResults.length],
    ['To Scrape', toScrape.length],
    ['Metadata Only', metadataOnly.length],
    ['', ''],
    ['To Scrape', ''],
    ['#', 'URL', 'Reason'],
    ...toScrape.map((r, i) => [i + 1, r.url, r.reason]),
    ['', ''],
    ['Metadata Only', ''],
    ['#', 'URL', 'Title', 'Description', 'Reason'],
    ...metadataOnly.map((r, i) => [
      i + 1,
      r.url,
      r.title || '',
      r.description || '',
      r.reason,
    ]),
  ];

  const step4Workbook = XLSX.utils.book_new();
  const step4Sheet = XLSX.utils.aoa_to_sheet(step4Data);
  XLSX.utils.book_append_sheet(step4Workbook, step4Sheet, 'Step 4 Filter');
  const step4Path = path.join(resultsDir, 'test-blackberry-step4-filter.xlsx');
  XLSX.writeFile(step4Workbook, step4Path);
  console.log(`💾 Saved Step 4 results to: ${path.basename(step4Path)}\n`);

  // STEP 5: Scrape Articles
  console.log('📄 Step 5: Scraping articles...\n');
  const scrapedContent: Array<{ url: string; markdown?: string; error?: string }> = [];

  for (let i = 0; i < toScrape.length; i++) {
    const item = toScrape[i];
    console.log(`  Scraping ${i + 1}/${toScrape.length}: ${item.url.substring(0, 60)}...`);

    try {
      const scrapeResponse = await firecrawl.scrapeUrl(item.url, {
        formats: ['markdown'],
        onlyMainContent: true,
      });

      costTracker.trackFirecrawlScrape(1);

      if (scrapeResponse.markdown) {
        scrapedContent.push({
          url: item.url,
          markdown: scrapeResponse.markdown,
        });
      } else {
        scrapedContent.push({
          url: item.url,
          error: 'No markdown content returned',
        });
      }
    } catch (error: any) {
      console.error(`  ⚠️  Error scraping ${item.url}: ${error.message}`);
      scrapedContent.push({
        url: item.url,
        error: error.message,
      });
    }
  }

  console.log(`✅ Scraped ${scrapedContent.filter(c => c.markdown).length}/${toScrape.length} articles\n`);

  // Save scraped content to JSON (Excel has cell size limits)
  const scrapedContentPath = path.join(resultsDir, 'test-blackberry-step5-scraped-content.json');
  await fs.writeFile(scrapedContentPath, JSON.stringify(scrapedContent, null, 2), 'utf-8');

  // Save Step 5 summary to Excel
  const step5Data = [
    ['Query', query],
    ['Total to Scrape', toScrape.length],
    ['Successfully Scraped', scrapedContent.filter(c => c.markdown).length],
    ['Failed', scrapedContent.filter(c => c.error).length],
    ['', ''],
    ['Scraped Articles', ''],
    ['#', 'URL', 'Status', 'Content Length'],
    ...scrapedContent.map((c, i) => [
      i + 1,
      c.url,
      c.markdown ? 'Success' : 'Failed',
      c.markdown ? c.markdown.length : (c.error || 'N/A'),
    ]),
  ];

  const step5Workbook = XLSX.utils.book_new();
  const step5Sheet = XLSX.utils.aoa_to_sheet(step5Data);
  XLSX.utils.book_append_sheet(step5Workbook, step5Sheet, 'Step 5 Scrape');
  const step5Path = path.join(resultsDir, 'test-blackberry-step5-scrape.xlsx');
  XLSX.writeFile(step5Workbook, step5Path);
  console.log(`💾 Saved Step 5 results to: ${path.basename(step5Path)}`);
  console.log(`💾 Saved scraped content to: ${path.basename(scrapedContentPath)}\n`);

  // STEP 6: Process and Summarize
  console.log('📊 Step 6: Processing and summarizing...\n');
  
  // Create a SearchResponse-like object for processSerpResult
  const combinedResult = {
    data: [
      ...scrapedContent.filter(c => c.markdown).map(c => ({
        url: c.url,
        markdown: c.markdown!,
      })),
      ...metadataOnly.map(m => ({
        url: m.url,
        markdown: `Title: ${m.title || 'N/A'}\nDescription: ${m.description || 'N/A'}`,
      })),
    ],
  };

  const { learnings, followUpQuestions } = await processSerpResult({
    query,
    result: combinedResult as any,
  });

  const processPromptLength = query.length + combinedResult.data.map(c => c.markdown || '').join(' ').length + 2000;
  const estimatedProcessLength = learnings.join(' ').length;
  costTracker.trackLLMCallEstimate(modelId, processPromptLength, estimatedProcessLength, 'process_serp_result');

  console.log(`✅ Generated ${learnings.length} learnings\n`);

  // Save Step 6 results
  const step6Data = [
    ['Query', query],
    ['Total Content Items', combinedResult.data.length],
    ['Learnings Generated', learnings.length],
    ['Follow-up Questions', followUpQuestions.length],
    ['', ''],
    ['Learnings', ''],
    ['#', 'Learning', 'Type', 'Length'],
    ...learnings.map((l, i) => {
      const type = l.includes('[RECENT CHANGE]')
        ? 'RECENT CHANGE'
        : l.includes('[LONG-TERM TREND]')
          ? 'LONG-TERM TREND'
          : l.includes('[CONTEXT]')
            ? 'CONTEXT'
            : 'UNKNOWN';
      return [i + 1, l, type, l.length];
    }),
    ['', ''],
    ['Follow-up Questions', ''],
    ...followUpQuestions.map((q, i) => [i + 1, q]),
  ];

  const step6Workbook = XLSX.utils.book_new();
  const step6Sheet = XLSX.utils.aoa_to_sheet(step6Data);
  XLSX.utils.book_append_sheet(step6Workbook, step6Sheet, 'Step 6 Process');
  const step6Path = path.join(resultsDir, 'test-blackberry-step6-process.xlsx');
  XLSX.writeFile(step6Workbook, step6Path);
  console.log(`💾 Saved Step 6 results to: ${path.basename(step6Path)}\n`);

  // STEP 7: Generate Final Report
  console.log('📝 Step 7: Generating final report...\n');
  const visitedUrls = [...new Set([...scrapedContent.map(c => c.url), ...metadataOnly.map(m => m.url)])];

  const reportPromptLength = query.length + learnings.join(' ').length + visitedUrls.join(' ').length + 3000;
  const estimatedReportLength = 5000;
  costTracker.trackLLMCallEstimate(modelId, reportPromptLength, estimatedReportLength, 'generate_report');

  const report = await writeFinalReport({
    prompt: query,
    learnings,
    visitedUrls,
  });

  const reportPath = path.join(resultsDir, 'test-blackberry-step7-report.md');
  await fs.writeFile(reportPath, report, 'utf-8');

  console.log(`✅ Report generated (${report.length} characters)\n`);

  // Save Step 7 summary
  const step7Data = [
    ['Query', query],
    ['Report Length', report.length],
    ['Report Lines', report.split('\n').length],
    ['Learnings Used', learnings.length],
    ['URLs Included', visitedUrls.length],
    ['', ''],
    ['Report Preview (first 1000 chars)', ''],
    [report.substring(0, 1000)],
  ];

  const step7Workbook = XLSX.utils.book_new();
  const step7Sheet = XLSX.utils.aoa_to_sheet(step7Data);
  XLSX.utils.book_append_sheet(step7Workbook, step7Sheet, 'Step 7 Report');
  const step7Path = path.join(resultsDir, 'test-blackberry-step7-report.xlsx');
  XLSX.writeFile(step7Workbook, step7Path);
  console.log(`💾 Saved Step 7 report to: ${path.basename(reportPath)}`);
  console.log(`💾 Saved Step 7 summary to: ${path.basename(step7Path)}\n`);

  // Final Summary
  const totalTime = Date.now() - startTime;
  const costSummary = costTracker.getSummary();

  console.log('📈 Full Integration Test Results:');
  console.log(`  Total time: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`  SERP Queries: ${serpQueries.length}`);
  console.log(`  Articles gathered: ${allSearchResults.length}`);
  console.log(`  Articles triaged: ${triagedResults.length}`);
  console.log(`  Articles scraped: ${scrapedContent.filter(c => c.markdown).length}`);
  console.log(`  Learnings generated: ${learnings.length}`);
  console.log(`  URLs visited: ${visitedUrls.length}\n`);

  console.log('💰 Cost Summary:');
  console.log(`  Total cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`  Cost by service: ${JSON.stringify(costSummary.costByService, null, 2)}`);
  console.log(`  Cost by operation: ${JSON.stringify(costSummary.costByOperation, null, 2)}\n`);

  // Save comprehensive summary
  const summaryData = [
    ['Full Integration Test Summary', ''],
    ['Query', query],
    ['Breadth', breadth],
    ['Depth', depth],
    ['Total Time (s)', (totalTime / 1000).toFixed(1)],
    ['', ''],
    ['Step Results', ''],
    ['Step 1-2: Gather', `${allSearchResults.length} articles`],
    ['Step 3: Triage', `${triagedResults.length} selected`],
    ['Step 4: Filter', `${toScrape.length} to scrape, ${metadataOnly.length} metadata only`],
    ['Step 5: Scrape', `${scrapedContent.filter(c => c.markdown).length} scraped`],
    ['Step 6: Process', `${learnings.length} learnings`],
    ['Step 7: Report', `${report.length} characters`],
    ['', ''],
    ['Cost Summary', ''],
    ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
    ['Cost Per Learning', `$${(costSummary.totalCost / learnings.length).toFixed(4)}`],
    ['', ''],
    ['Cost by Service', ''],
    ...Object.entries(costSummary.costByService).map(([service, cost]) => [service, `$${cost.toFixed(4)}`]),
    ['', ''],
    ['Cost by Operation', ''],
    ...Object.entries(costSummary.costByOperation).map(([op, cost]) => [op, `$${cost.toFixed(4)}`]),
    ['', ''],
    ['Files Saved', ''],
    ['Step 1-2', 'test-blackberry-step1-2-gather.xlsx'],
    ['Step 3', 'test-blackberry-step3-triage.xlsx'],
    ['Step 4', 'test-blackberry-step4-filter.xlsx'],
    ['Step 5', 'test-blackberry-step5-scrape.xlsx'],
    ['Step 5 Content', 'test-blackberry-step5-scraped-content.json'],
    ['Step 6', 'test-blackberry-step6-process.xlsx'],
    ['Step 7 Report', 'test-blackberry-step7-report.md'],
    ['Step 7 Summary', 'test-blackberry-step7-report.xlsx'],
  ];

  const summaryWorkbook = XLSX.utils.book_new();
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(summaryWorkbook, summarySheet, 'Summary');
  const summaryPath = path.join(resultsDir, 'test-blackberry-full-integration-summary.xlsx');
  XLSX.writeFile(summaryWorkbook, summaryPath);

  console.log('✅ Full integration test complete!');
  console.log(`📊 Summary: ${path.basename(summaryPath)}`);
  console.log(`📝 Report: ${path.basename(reportPath)}\n`);

  return {
    query,
    breadth,
    depth,
    totalTime,
    learnings: learnings.length,
    visitedUrls: visitedUrls.length,
    summaryPath,
    reportPath,
  };
}

testFullIntegrationBlackberry()
  .then((result) => {
    console.log('✅ All steps completed and saved!');
    console.log(`📊 Summary: ${result.summaryPath}`);
    console.log(`📝 Report: ${result.reportPath}`);
  })
  .catch(console.error);
