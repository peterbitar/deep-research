// Comprehensive Test: Run All Steps Sequentially
// Tests the complete pipeline from query to final report
// Validates each step before proceeding to the next
// Designed for pre-test-flight validation

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';
import FirecrawlApp from '@mendable/firecrawl-js';
import {
  generateSerpQueries,
  retryFirecrawlSearch,
  triageTitlesBatched,
  filterScrapeNeedsBatched,
  processSerpResult,
  writeFinalReport,
} from '../src/deep-research';
import { CostTracker } from './cost-tracker';
import { getModel } from '../src/ai/providers';
import type { SearchResponse } from '@mendable/firecrawl-js';

const firecrawl = new FirecrawlApp({
  apiKey: process.env.FIRECRAWL_KEY || '',
  baseURL: process.env.FIRECRAWL_BASE_URL || 'https://api.firecrawl.dev',
});

interface StepResult {
  step: number;
  name: string;
  success: boolean;
  error?: string;
  duration: number;
  metrics: Record<string, any>;
  cost: number;
}

interface TestResults {
  query: string;
  breadth: number;
  depth: number;
  totalDuration: number;
  totalCost: number;
  steps: StepResult[];
  finalReport?: string;
  reportPath?: string;
  excelPath: string;
}

async function testAllSteps() {
  console.log('🚀 Comprehensive Test: All Steps Sequential\n');
  console.log('=' .repeat(60));
  console.log('PRE-TEST-FLIGHT VALIDATION');
  console.log('=' .repeat(60) + '\n');

  const costTracker = new CostTracker();
  // Use a small, focused query for quick validation
  // Options: Single stock (NVDA), single crypto (BTC), or small portfolio
  const query = process.argv[2] || 'What happened with NVIDIA this week?';
  const breadth = parseInt(process.argv[3] || '3', 10); // Reduced for quick test (default: 3)
  const depth = parseInt(process.argv[4] || '1', 10); // Single depth for quick test (default: 1)

  const startTime = Date.now();
  const steps: StepResult[] = [];
  let currentData: any = {};

  console.log(`📝 Test Configuration:`);
  console.log(`   Query: ${query}`);
  console.log(`   Breadth: ${breadth}`);
  console.log(`   Depth: ${depth}`);
  console.log(`\n💡 Tip: You can customize the test with:`);
  console.log(`   npm run tsx scripts/test-all-steps.ts "Your query" <breadth> <depth>`);
  console.log(`   Example: npm run tsx scripts/test-all-steps.ts "AAPL news" 2 1\n`);

  // ==========================================
  // STEP 1: Generate SERP Queries
  // ==========================================
  console.log('📋 STEP 1: Generate SERP Queries');
  console.log('-'.repeat(60));
  const step1Start = Date.now();
  try {
    const model = getModel();
    const modelId = (model as any).modelId || 'unknown';
    const queryPromptLength = query.length + 500;
    costTracker.trackLLMCallEstimate(modelId, queryPromptLength, 1000, 'step1_generate_queries');

    const serpQueries = await generateSerpQueries({
      query,
      numQueries: breadth,
    });

    const step1Duration = Date.now() - step1Start;
    console.log(`✅ Generated ${serpQueries.length} queries in ${(step1Duration / 1000).toFixed(1)}s`);
    serpQueries.forEach((q, i) => {
      console.log(`   ${i + 1}. ${q.query}`);
    });

    currentData = { serpQueries, query };
    steps.push({
      step: 1,
      name: 'Generate SERP Queries',
      success: true,
      duration: step1Duration,
      metrics: {
        queriesGenerated: serpQueries.length,
        queries: serpQueries.map(q => q.query),
      },
      cost: costTracker.getSummary().totalCost,
    });
  } catch (error: any) {
    const step1Duration = Date.now() - step1Start;
    console.log(`❌ Step 1 failed: ${error.message}`);
    steps.push({
      step: 1,
      name: 'Generate SERP Queries',
      success: false,
      error: error.message,
      duration: step1Duration,
      metrics: {},
      cost: costTracker.getSummary().totalCost,
    });
    throw error;
  }
  console.log('');

  // ==========================================
  // STEP 2: Gather Search Results
  // ==========================================
  console.log('🔍 STEP 2: Gather Search Results');
  console.log('-'.repeat(60));
  const step2Start = Date.now();
  try {
    const { serpQueries } = currentData;
    costTracker.trackFirecrawlSearch(serpQueries.length);

    const allSearchResults = await Promise.all(
      serpQueries.map(async (serpQuery: any) => {
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
              publishedDate: (item as any).publishedDate || (item as any).metadata?.publishedDate,
            })),
          };
        } catch (e: any) {
          console.warn(`   ⚠️  Error searching "${serpQuery.query}": ${e.message}`);
          return {
            query: serpQuery.query,
            researchGoal: serpQuery.researchGoal,
            results: [],
          };
        }
      })
    );

    // Deduplicate by URL
    const urlMap = new Map<string, any>();
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
            publishedDate: article.publishedDate,
            sourceQueries: [searchResult.query],
            researchGoals: [searchResult.researchGoal],
          });
        }
      }
    }

    const allArticles = Array.from(urlMap.values());
    const totalBeforeDedup = allSearchResults.reduce((sum, r) => sum + r.results.length, 0);

    const step2Duration = Date.now() - step2Start;
    console.log(`✅ Gathered ${allArticles.length} unique articles from ${totalBeforeDedup} total results`);
    console.log(`   Duplicates removed: ${totalBeforeDedup - allArticles.length}`);

    currentData = {
      ...currentData,
      allSearchResults,
      allArticles,
      researchGoals: [...new Set(allSearchResults.flatMap((r) => r.researchGoal))],
    };
    steps.push({
      step: 2,
      name: 'Gather Search Results',
      success: true,
      duration: step2Duration,
      metrics: {
        totalResults: totalBeforeDedup,
        uniqueArticles: allArticles.length,
        duplicatesRemoved: totalBeforeDedup - allArticles.length,
      },
      cost: costTracker.getSummary().totalCost,
    });
  } catch (error: any) {
    const step2Duration = Date.now() - step2Start;
    console.log(`❌ Step 2 failed: ${error.message}`);
    steps.push({
      step: 2,
      name: 'Gather Search Results',
      success: false,
      error: error.message,
      duration: step2Duration,
      metrics: {},
      cost: costTracker.getSummary().totalCost,
    });
    throw error;
  }
  console.log('');

  // ==========================================
  // STEP 3: Batch Triage
  // ==========================================
  console.log('🎯 STEP 3: Batch Triage');
  console.log('-'.repeat(60));
  const step3Start = Date.now();
  try {
    const { allArticles, query, researchGoals } = currentData;

    if (allArticles.length === 0) {
      throw new Error('No articles to triage');
    }

    const model = getModel();
    const modelId = (model as any).modelId || 'unknown';
    const triagePromptLength =
      query.length +
      researchGoals.join(' ').length +
      allArticles.reduce((sum: number, a: any) => sum + (a.title?.length || 0) + (a.description?.length || 0), 0) +
      1000;
    costTracker.trackLLMCallEstimate(modelId, triagePromptLength, 500, 'step3_triage');

    const triagedUrls = await triageTitlesBatched({
      query,
      results: allArticles,
      researchGoals,
    });

    const triagedArticles = allArticles.filter((a: any) => triagedUrls.includes(a.url));
    const rejectedArticles = allArticles.filter((a: any) => !triagedUrls.includes(a.url));

    const step3Duration = Date.now() - step3Start;
    console.log(`✅ Selected ${triagedArticles.length} articles from ${allArticles.length} total`);
    console.log(`   Rejected: ${rejectedArticles.length}`);
    console.log(`   Selection rate: ${((triagedArticles.length / allArticles.length) * 100).toFixed(1)}%`);

    currentData = { ...currentData, triagedArticles };
    steps.push({
      step: 3,
      name: 'Batch Triage',
      success: true,
      duration: step3Duration,
      metrics: {
        inputArticles: allArticles.length,
        selectedArticles: triagedArticles.length,
        rejectedArticles: rejectedArticles.length,
        selectionRate: `${((triagedArticles.length / allArticles.length) * 100).toFixed(1)}%`,
      },
      cost: costTracker.getSummary().totalCost,
    });
  } catch (error: any) {
    const step3Duration = Date.now() - step3Start;
    console.log(`❌ Step 3 failed: ${error.message}`);
    steps.push({
      step: 3,
      name: 'Batch Triage',
      success: false,
      error: error.message,
      duration: step3Duration,
      metrics: {},
      cost: costTracker.getSummary().totalCost,
    });
    throw error;
  }
  console.log('');

  // ==========================================
  // STEP 4: Filter Scrape Needs
  // ==========================================
  console.log('🔍 STEP 4: Filter Scrape Needs');
  console.log('-'.repeat(60));
  const step4Start = Date.now();
  try {
    const { triagedArticles, query, researchGoals } = currentData;

    if (triagedArticles.length === 0) {
      throw new Error('No triaged articles to filter');
    }

    const model = getModel();
    const modelId = (model as any).modelId || 'unknown';
    const filterPromptLength =
      query.length +
      researchGoals.join(' ').length +
      triagedArticles.reduce((sum: number, a: any) => sum + (a.title?.length || 0) + (a.description?.length || 0), 0) +
      1500;
    costTracker.trackLLMCallEstimate(modelId, filterPromptLength, 800, 'step4_filter');

    const { toScrape, metadataOnly } = await filterScrapeNeedsBatched({
      query,
      triagedResults: triagedArticles,
      researchGoals,
    });

    const step4Duration = Date.now() - step4Start;
    console.log(`✅ Filtered ${triagedArticles.length} articles`);
    console.log(`   To scrape: ${toScrape.length}`);
    console.log(`   Metadata-only: ${metadataOnly.length}`);
    console.log(`   Scraping rate: ${((toScrape.length / triagedArticles.length) * 100).toFixed(1)}%`);

    currentData = { ...currentData, toScrape, metadataOnly };
    steps.push({
      step: 4,
      name: 'Filter Scrape Needs',
      success: true,
      duration: step4Duration,
      metrics: {
        inputArticles: triagedArticles.length,
        toScrape: toScrape.length,
        metadataOnly: metadataOnly.length,
        scrapingRate: `${((toScrape.length / triagedArticles.length) * 100).toFixed(1)}%`,
      },
      cost: costTracker.getSummary().totalCost,
    });
  } catch (error: any) {
    const step4Duration = Date.now() - step4Start;
    console.log(`❌ Step 4 failed: ${error.message}`);
    steps.push({
      step: 4,
      name: 'Filter Scrape Needs',
      success: false,
      error: error.message,
      duration: step4Duration,
      metrics: {},
      cost: costTracker.getSummary().totalCost,
    });
    throw error;
  }
  console.log('');

  // ==========================================
  // STEP 5: Scrape Articles
  // ==========================================
  console.log('📥 STEP 5: Scrape Articles');
  console.log('-'.repeat(60));
  const step5Start = Date.now();
  try {
    const { toScrape } = currentData;

    if (toScrape.length === 0) {
      console.log('   ⚠️  No articles to scrape, skipping...');
      currentData = { ...currentData, scrapedContent: [] };
    } else {
      costTracker.trackFirecrawlScrape(toScrape.length);

      const scrapedResults = await Promise.all(
        toScrape.map(({ url }: any) =>
          retryFirecrawlSearch(
            async () => {
              if (typeof (firecrawl as any).scrapeUrl === 'function') {
                return await (firecrawl as any).scrapeUrl(url, { formats: ['markdown'], onlyMainContent: true });
              } else if (typeof (firecrawl as any).scrape === 'function') {
                return await (firecrawl as any).scrape(url, { formats: ['markdown'], onlyMainContent: true });
              } else {
                const result = await firecrawl.search(`site:${new URL(url).hostname} ${url}`, {
                  limit: 1,
                  scrapeOptions: { formats: ['markdown'] },
                });
                return result.data[0] || { url, markdown: '' };
              }
            },
            url
          )
        )
      );

      const scrapedContent = scrapedResults.map((scraped, index) => {
        const markdown =
          scraped?.markdown ||
          scraped?.data?.markdown ||
          scraped?.content?.markdown ||
          (typeof scraped === 'string' ? scraped : '');
        return {
          url: toScrape[index].url,
          markdown: markdown || undefined,
          success: !!markdown,
        };
      });

      const successCount = scrapedContent.filter((c) => c.success).length;
      const step5Duration = Date.now() - step5Start;
      console.log(`✅ Scraped ${successCount}/${toScrape.length} articles in ${(step5Duration / 1000).toFixed(1)}s`);

      currentData = { ...currentData, scrapedContent };
      steps.push({
        step: 5,
        name: 'Scrape Articles',
        success: true,
        duration: step5Duration,
        metrics: {
          attempted: toScrape.length,
          successful: successCount,
          failed: toScrape.length - successCount,
          successRate: `${((successCount / toScrape.length) * 100).toFixed(1)}%`,
        },
        cost: costTracker.getSummary().totalCost,
      });
    }
  } catch (error: any) {
    const step5Duration = Date.now() - step5Start;
    console.log(`❌ Step 5 failed: ${error.message}`);
    steps.push({
      step: 5,
      name: 'Scrape Articles',
      success: false,
      error: error.message,
      duration: step5Duration,
      metrics: {},
      cost: costTracker.getSummary().totalCost,
    });
    throw error;
  }
  console.log('');

  // ==========================================
  // STEP 6: Process Results
  // ==========================================
  console.log('📝 STEP 6: Process Results');
  console.log('-'.repeat(60));
  const step6Start = Date.now();
  try {
    const { scrapedContent, metadataOnly, query } = currentData;

    // Combine scraped + metadata into SearchResponse format
    const combinedResult: SearchResponse = {
      data: [
        ...(scrapedContent || []).filter((c: any) => c.markdown).map((c: any) => ({
          url: c.url,
          markdown: c.markdown!,
        })),
        ...(metadataOnly || []).map((meta: any) => ({
          url: meta.url,
          markdown: `Title: ${meta.title || 'No title'}\n\nDescription: ${meta.description || meta.snippet || 'No description'}\n\n[Metadata only - not fully scraped. Reason: ${meta.reason}]`,
        })),
      ],
    };

    if (combinedResult.data.length === 0) {
      throw new Error('No articles to process');
    }

    const model = getModel();
    const modelId = (model as any).modelId || 'unknown';
    const processPromptLength =
      query.length + combinedResult.data.reduce((sum, item) => sum + (item.markdown?.length || 0), 0) + 2000;
    const estimatedOutputLength = 5 * 200 + 3 * 100; // 5 learnings, 3 follow-ups
    costTracker.trackLLMCallEstimate(modelId, processPromptLength, estimatedOutputLength, 'step6_process');

    const result = await processSerpResult({
      query,
      result: combinedResult,
      numLearnings: 5,
      numFollowUpQuestions: 3,
    });

    const step6Duration = Date.now() - step6Start;
    console.log(`✅ Extracted ${result.learnings.length} learnings`);
    console.log(`   Follow-up questions: ${result.followUpQuestions.length}`);

    currentData = { ...currentData, learnings: result.learnings, visitedUrls: combinedResult.data.map((d) => d.url) };
    steps.push({
      step: 6,
      name: 'Process Results',
      success: true,
      duration: step6Duration,
      metrics: {
        learningsExtracted: result.learnings.length,
        followUpQuestions: result.followUpQuestions.length,
        articlesProcessed: combinedResult.data.length,
      },
      cost: costTracker.getSummary().totalCost,
    });
  } catch (error: any) {
    const step6Duration = Date.now() - step6Start;
    console.log(`❌ Step 6 failed: ${error.message}`);
    steps.push({
      step: 6,
      name: 'Process Results',
      success: false,
      error: error.message,
      duration: step6Duration,
      metrics: {},
      cost: costTracker.getSummary().totalCost,
    });
    throw error;
  }
  console.log('');

  // ==========================================
  // STEP 7: Generate Final Report
  // ==========================================
  console.log('📄 STEP 7: Generate Final Report');
  console.log('-'.repeat(60));
  const step7Start = Date.now();
  try {
    const { learnings, visitedUrls, query } = currentData;

    if (learnings.length === 0) {
      throw new Error('No learnings to generate report from');
    }

    const model = getModel();
    const modelId = (model as any).modelId || 'unknown';
    const reportPromptLength = query.length + learnings.join(' ').length + visitedUrls.join(' ').length + 3000;
    const estimatedReportLength = 5000;
    costTracker.trackLLMCallEstimate(modelId, reportPromptLength, estimatedReportLength, 'step7_generate_report');

    const report = await writeFinalReport({
      prompt: query,
      learnings,
      visitedUrls,
    });

    const step7Duration = Date.now() - step7Start;
    console.log(`✅ Generated report (${report.length} characters, ${report.split('\n').length} lines)`);

    // Save report
    const reportPath = path.join(process.cwd(), 'test-results', 'test-all-steps-report.md');
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, report, 'utf-8');

    currentData = { ...currentData, report, reportPath };
    steps.push({
      step: 7,
      name: 'Generate Final Report',
      success: true,
      duration: step7Duration,
      metrics: {
        reportLength: report.length,
        reportLines: report.split('\n').length,
        learningsUsed: learnings.length,
        urlsIncluded: visitedUrls.length,
      },
      cost: costTracker.getSummary().totalCost,
    });
  } catch (error: any) {
    const step7Duration = Date.now() - step7Start;
    console.log(`❌ Step 7 failed: ${error.message}`);
    steps.push({
      step: 7,
      name: 'Generate Final Report',
      success: false,
      error: error.message,
      duration: step7Duration,
      metrics: {},
      cost: costTracker.getSummary().totalCost,
    });
    throw error;
  }
  console.log('');

  // ==========================================
  // FINAL SUMMARY
  // ==========================================
  const totalDuration = Date.now() - startTime;
  const costSummary = costTracker.getSummary();
  const allStepsPassed = steps.every((s) => s.success);

  console.log('=' .repeat(60));
  console.log('TEST SUMMARY');
  console.log('=' .repeat(60));
  console.log(`✅ All Steps: ${allStepsPassed ? 'PASSED' : 'FAILED'}`);
  console.log(`⏱️  Total Duration: ${(totalDuration / 1000).toFixed(1)}s`);
  console.log(`💰 Total Cost: $${costSummary.totalCost.toFixed(4)}`);
  console.log(`📊 Steps Completed: ${steps.filter((s) => s.success).length}/${steps.length}\n`);

  console.log('Step Breakdown:');
  steps.forEach((step) => {
    const status = step.success ? '✅' : '❌';
    const duration = (step.duration / 1000).toFixed(1);
    const cost = step.cost.toFixed(4);
    console.log(`  ${status} Step ${step.step}: ${step.name} (${duration}s, $${cost})`);
    if (!step.success && step.error) {
      console.log(`     Error: ${step.error}`);
    }
  });
  console.log('');

  // Export to Excel
  const excelPath = path.join(process.cwd(), 'test-results', 'test-all-steps.xlsx');
  await fs.mkdir(path.dirname(excelPath), { recursive: true });

  const workbook = XLSX.utils.book_new();

  // Sheet 1: Summary
  const summaryData = [
    ['Metric', 'Value'],
    ['Test Type', 'All Steps Sequential'],
    ['Query', query],
    ['Breadth', breadth],
    ['Depth', depth],
    ['All Steps Passed', allStepsPassed ? 'YES' : 'NO'],
    ['Total Duration (s)', (totalDuration / 1000).toFixed(1)],
    ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
    ['Steps Completed', `${steps.filter((s) => s.success).length}/${steps.length}`],
    ['', ''],
    ['Cost by Service', ''],
    ...Object.entries(costSummary.costByService).map(([service, cost]) => [service, `$${cost.toFixed(4)}`]),
    ['', ''],
    ['Cost by Operation', ''],
    ...Object.entries(costSummary.costByOperation).map(([op, cost]) => [op, `$${cost.toFixed(4)}`]),
  ];
  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

  // Sheet 2: Steps
  const stepsData = [
    ['Step', 'Name', 'Status', 'Duration (s)', 'Cost', 'Error', 'Metrics'],
    ...steps.map((step) => [
      step.step,
      step.name,
      step.success ? 'PASS' : 'FAIL',
      (step.duration / 1000).toFixed(1),
      `$${step.cost.toFixed(4)}`,
      step.error || '',
      JSON.stringify(step.metrics),
    ]),
  ];
  const stepsSheet = XLSX.utils.aoa_to_sheet(stepsData);
  XLSX.utils.book_append_sheet(workbook, stepsSheet, 'Steps');

  // Sheet 3: Learnings
  if (currentData.learnings) {
    const learningsData = [
      ['#', 'Learning', 'Type', 'Length'],
      ...currentData.learnings.map((learning: string, i: number) => {
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
  }

  // Sheet 4: Visited URLs
  if (currentData.visitedUrls) {
    const urlsData = [
      ['#', 'URL', 'Domain'],
      ...currentData.visitedUrls.map((url: string, i: number) => {
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
  }

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

  XLSX.writeFile(workbook, excelPath);

  const results: TestResults = {
    query,
    breadth,
    depth,
    totalDuration,
    totalCost: costSummary.totalCost,
    steps,
    finalReport: currentData.report,
    reportPath: currentData.reportPath,
    excelPath,
  };

  console.log('📊 Results exported:');
  console.log(`   Excel: ${path.basename(excelPath)}`);
  if (currentData.reportPath) {
    console.log(`   Report: ${path.basename(currentData.reportPath)}`);
  }
  console.log('');

  if (allStepsPassed) {
    console.log('🎉 ALL STEPS PASSED - READY FOR TEST FLIGHT!');
  } else {
    console.log('⚠️  SOME STEPS FAILED - REVIEW ERRORS BEFORE TEST FLIGHT');
  }
  console.log('');

  return results;
}

testAllSteps()
  .then((results) => {
    const allPassed = results.steps.every((s) => s.success);
    process.exit(allPassed ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
