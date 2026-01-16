// Pipeline Data Saver: Saves intermediate results from deepResearch pipeline
// Provides Excel and JSON exports for each step and iteration

import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';

export type IterationData = {
  iteration: number; // 0-based, 0 = initial iteration
  depth: number; // Remaining depth at start of iteration
  query: string;
  researchLabel?: string; // Label for this research (e.g., "BTC", "NVIDIA", "Macro-CentralBank") - used for portfolio research
  serpQueries: Array<{ query: string; researchGoal: string }>;
  gatheredArticles: Array<{ url: string; title?: string; description?: string; snippet?: string }>;
  triagedArticles: Array<{ url: string; title?: string; description?: string; snippet?: string }>;
  toScrape: Array<{ url: string; reason: string }>;
  metadataOnly: Array<{ url: string; title?: string; description?: string; reason: string }>;
  scrapedContent: Array<{ url: string; markdown?: string; error?: string }>;
  learnings: string[];
  followUpQuestions: string[];
  visitedUrls: string[];
  timestamp: string;
  previousIterationFollowUps?: string[]; // Follow-up questions from previous iteration that led to this one
};

export class PipelineDataSaver {
  private baseDir: string;
  private runId: string;
  public iterations: IterationData[] = []; // Made public so deepResearch can access previous iterations
  private startTime: number;

  constructor(baseDir?: string) {
    this.baseDir = baseDir || path.join(process.cwd(), 'research-results');
    this.runId = `research-${Date.now()}`;
    this.startTime = Date.now();
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.baseDir, { recursive: true });
    await fs.mkdir(path.join(this.baseDir, this.runId), { recursive: true });
  }

  getRunId(): string {
    return this.runId;
  }

  getRunDir(): string {
    return path.join(this.baseDir, this.runId);
  }

  async saveIterationData(iteration: number, data: Omit<IterationData, 'iteration' | 'timestamp'>): Promise<void> {
    const iterationData: IterationData = {
      iteration,
      timestamp: new Date().toISOString(),
      ...data,
    };

    this.iterations.push(iterationData);

    // Create iteration directory, with subdirectory for research label if provided
    let iterationDir = path.join(this.getRunDir(), `iteration-${iteration}`);
    if (data.researchLabel) {
      iterationDir = path.join(iterationDir, data.researchLabel);
    }
    await fs.mkdir(iterationDir, { recursive: true });

    // Save Step 1-2: Gather
    await this.saveStep1_2(iterationDir, iterationData);

    // Save Step 3: Triage
    await this.saveStep3(iterationDir, iterationData);

    // Save Step 4: Filter
    await this.saveStep4(iterationDir, iterationData);

    // Save Step 5: Scrape (JSON for content, Excel for summary)
    await this.saveStep5(iterationDir, iterationData);

    // Save Step 6: Process
    await this.saveStep6(iterationDir, iterationData);
  }

  private async saveStep1_2(iterationDir: string, data: IterationData): Promise<void> {
    const stepData: any[] = [
      ['Iteration', data.iteration],
      ['Research Label', data.researchLabel || 'Main Research'],
      ['Depth', data.depth],
      ['Query', data.query],
      ['Breadth', data.serpQueries.length],
      ['', ''],
    ];

    // Show connection to previous iteration if applicable
    if (data.previousIterationFollowUps && data.previousIterationFollowUps.length > 0) {
      stepData.push(
        ['Connection to Previous Iteration', ''],
        ['Follow-up Questions from Iteration ' + (data.iteration - 1), ''],
        ...data.previousIterationFollowUps.map((q, i) => [i + 1, q]),
        ['', ''],
        ['These follow-up questions were used to generate the query and SERP queries below', ''],
        ['', ''],
      );
    }

    stepData.push(
      ['SERP Queries', ''],
      ['#', 'Query', 'Research Goal'],
      ...data.serpQueries.map((q, i) => [i + 1, q.query, q.researchGoal]),
      ['', ''],
      ['Search Results', ''],
      ['Total Unique Articles', data.gatheredArticles.length],
      ['', ''],
      ['Articles', ''],
      ['#', 'URL', 'Title', 'Description'],
      ...data.gatheredArticles.map((r, i) => [
        i + 1,
        r.url,
        r.title || '',
        r.description || r.snippet || '',
      ]),
    );

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(stepData);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Step 1-2 Gather');
    const filePath = path.join(iterationDir, 'step1-2-gather.xlsx');
    XLSX.writeFile(workbook, filePath);
  }

  private async saveStep3(iterationDir: string, data: IterationData): Promise<void> {
    const stepData = [
      ['Iteration', data.iteration],
      ['Research Label', data.researchLabel || 'Main Research'],
      ['Query', data.query],
      ['Total Articles', data.gatheredArticles.length],
      ['Selected Articles', data.triagedArticles.length],
      ['', ''],
      ['Selected Articles', ''],
      ['#', 'URL', 'Title', 'Description'],
      ...data.triagedArticles.map((r, i) => [
        i + 1,
        r.url,
        r.title || '',
        r.description || r.snippet || '',
      ]),
    ];

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(stepData);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Step 3 Triage');
    const filePath = path.join(iterationDir, 'step3-triage.xlsx');
    XLSX.writeFile(workbook, filePath);
  }

  private async saveStep4(iterationDir: string, data: IterationData): Promise<void> {
    const stepData = [
      ['Iteration', data.iteration],
      ['Research Label', data.researchLabel || 'Main Research'],
      ['Query', data.query],
      ['Total Triaged', data.triagedArticles.length],
      ['To Scrape', data.toScrape.length],
      ['Metadata Only', data.metadataOnly.length],
      ['', ''],
      ['To Scrape', ''],
      ['#', 'URL', 'Reason'],
      ...data.toScrape.map((r, i) => [i + 1, r.url, r.reason]),
      ['', ''],
      ['Metadata Only', ''],
      ['#', 'URL', 'Title', 'Description', 'Reason'],
      ...data.metadataOnly.map((r, i) => [
        i + 1,
        r.url,
        r.title || '',
        r.description || '',
        r.reason,
      ]),
    ];

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(stepData);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Step 4 Filter');
    const filePath = path.join(iterationDir, 'step4-filter.xlsx');
    XLSX.writeFile(workbook, filePath);
  }

  private async saveStep5(iterationDir: string, data: IterationData): Promise<void> {
    // Save full content to JSON (Excel has cell size limits)
    const jsonPath = path.join(iterationDir, 'step5-scraped-content.json');
    await fs.writeFile(jsonPath, JSON.stringify(data.scrapedContent, null, 2), 'utf-8');

    // Save summary to Excel
    const stepData = [
      ['Iteration', data.iteration],
      ['Research Label', data.researchLabel || 'Main Research'],
      ['Query', data.query],
      ['Total to Scrape', data.toScrape.length],
      ['Successfully Scraped', data.scrapedContent.filter(c => c.markdown).length],
      ['Failed', data.scrapedContent.filter(c => c.error).length],
      ['', ''],
      ['Scraped Articles', ''],
      ['#', 'URL', 'Status', 'Content Length'],
      ...data.scrapedContent.map((c, i) => [
        i + 1,
        c.url,
        c.markdown ? 'Success' : 'Failed',
        c.markdown ? c.markdown.length : (c.error || 'N/A'),
      ]),
    ];

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(stepData);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Step 5 Scrape');
    const excelPath = path.join(iterationDir, 'step5-scrape.xlsx');
    XLSX.writeFile(workbook, excelPath);
  }

  private async saveStep6(iterationDir: string, data: IterationData): Promise<void> {
    const stepData = [
      ['Iteration', data.iteration],
      ['Research Label', data.researchLabel || 'Main Research'],
      ['Query', data.query],
      ['Total Content Items', data.scrapedContent.filter(c => c.markdown).length + data.metadataOnly.length],
      ['Learnings Generated', data.learnings.length],
      ['Follow-up Questions', data.followUpQuestions.length],
      ['', ''],
      ['Learnings', ''],
      ['#', 'Learning', 'Type', 'Length'],
      ...data.learnings.map((l, i) => {
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
      ...data.followUpQuestions.map((q, i) => [i + 1, q]),
      ['', ''],
      ['Visited URLs', ''],
      ...data.visitedUrls.map((url, i) => [i + 1, url]),
    ];

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(stepData);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Step 6 Process');
    const filePath = path.join(iterationDir, 'step6-process.xlsx');
    XLSX.writeFile(workbook, filePath);
  }

  async saveFinalReport(report: string, learnings: string[], visitedUrls: string[]): Promise<string> {
    const reportPath = path.join(this.getRunDir(), 'final-report.md');
    await fs.writeFile(reportPath, report, 'utf-8');

    // Save report summary
    const summaryData = [
      ['Final Report Summary', ''],
      ['Report Length', report.length],
      ['Report Lines', report.split('\n').length],
      ['Total Learnings Used', learnings.length],
      ['Total URLs Included', visitedUrls.length],
      ['', ''],
      ['Report Preview (first 2000 chars)', ''],
      [report.substring(0, 2000)],
    ];

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, sheet, 'Report Summary');
    const excelPath = path.join(this.getRunDir(), 'final-report-summary.xlsx');
    XLSX.writeFile(workbook, excelPath);

    return reportPath;
  }

  async saveComprehensiveSummary(
    initialQuery: string,
    totalDepth: number,
    totalBreadth: number,
    allLearnings: string[],
    allVisitedUrls: string[],
    costSummary?: any,
  ): Promise<string> {
    const totalTime = Date.now() - this.startTime;

    const summaryData = [
      ['Deep Research Comprehensive Summary', ''],
      ['Run ID', this.runId],
      ['Initial Query', initialQuery],
      ['Total Depth', totalDepth],
      ['Total Breadth', totalBreadth],
      ['Total Iterations', this.iterations.length],
      ['Total Time (s)', (totalTime / 1000).toFixed(1)],
      ['', ''],
      ['Overall Results', ''],
      ['Total Learnings', allLearnings.length],
      ['Total URLs Visited', allVisitedUrls.length],
      ['', ''],
      ['Iteration Summary', ''],
      ['Iteration', 'Research Label', 'Depth', 'Query', 'SERP Queries', 'Articles Gathered', 'Articles Triaged', 'To Scrape', 'Metadata Only', 'Learnings', 'Follow-up Questions'],
      ...this.iterations.map((iter) => [
        iter.iteration,
        iter.researchLabel || 'Main Research',
        iter.depth,
        iter.query.substring(0, 50) + (iter.query.length > 50 ? '...' : ''),
        iter.serpQueries.length,
        iter.gatheredArticles.length,
        iter.triagedArticles.length,
        iter.toScrape.length,
        iter.metadataOnly.length,
        iter.learnings.length,
        iter.followUpQuestions.length,
      ]),
      ['', ''],
      ['All Learnings', ''],
      ['#', 'Learning', 'Type', 'Iteration', 'Research Label', 'Length'],
      ...allLearnings.map((learning, i) => {
        // Find which iteration this learning came from
        const iteration = this.iterations.findIndex(
          (iter) => iter.learnings.includes(learning),
        );
        const iterData = iteration >= 0 ? this.iterations[iteration] : null;
        const type = learning.includes('[RECENT CHANGE]')
          ? 'RECENT CHANGE'
          : learning.includes('[LONG-TERM TREND]')
            ? 'LONG-TERM TREND'
            : learning.includes('[CONTEXT]')
              ? 'CONTEXT'
              : 'UNKNOWN';
        return [i + 1, learning, type, iteration >= 0 ? iteration : 'Unknown', iterData?.researchLabel || 'Main Research', learning.length];
      }),
      ['', ''],
      ['All Visited URLs', ''],
      ['#', 'URL', 'Domain', 'Iteration', 'Research Label'],
      ...allVisitedUrls.map((url, i) => {
        // Find which iteration this URL came from
        const iteration = this.iterations.findIndex(
          (iter) => iter.visitedUrls.includes(url),
        );
        const iterData = iteration >= 0 ? this.iterations[iteration] : null;
        let domain = '';
        try {
          domain = new URL(url).hostname;
        } catch {
          domain = url;
        }
        return [i + 1, url, domain, iteration >= 0 ? iteration : 'Unknown', iterData?.researchLabel || 'Main Research'];
      }),
    ];

    if (costSummary) {
      summaryData.push(
        ['', ''],
        ['Cost Summary', ''],
        ['Total Cost', `$${costSummary.totalCost.toFixed(4)}`],
        ['Cost Per Learning', `$${(costSummary.totalCost / allLearnings.length).toFixed(4)}`],
        ['', ''],
        ['Cost by Service', ''],
        ...Object.entries(costSummary.costByService || {}).map(([service, cost]) => [service, `$${(cost as number).toFixed(4)}`]),
        ['', ''],
        ['Cost by Operation', ''],
        ...Object.entries(costSummary.costByOperation || {}).map(([op, cost]) => [op, `$${(cost as number).toFixed(4)}`]),
      );
    }

    const workbook = XLSX.utils.book_new();
    const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(workbook, summarySheet, 'Summary');

    // Add iteration details sheets
    for (const iter of this.iterations) {
      const iterData = [
        ['Iteration Details', ''],
        ['Iteration', iter.iteration],
        ['Research Label', iter.researchLabel || 'Main Research'],
        ['Depth', iter.depth],
        ['Query', iter.query],
        ['Timestamp', iter.timestamp],
        ['', ''],
      ];

      // Show connection to previous iteration
      if (iter.previousIterationFollowUps && iter.previousIterationFollowUps.length > 0) {
        iterData.push(
          ['Connection to Previous Iteration', ''],
          ['Follow-up Questions from Iteration ' + (iter.iteration - 1) + ' (that led to this iteration)', ''],
          ...iter.previousIterationFollowUps.map((q, i) => [i + 1, q]),
          ['', ''],
        );
      }

      iterData.push(
        ['SERP Queries Generated', ''],
        ['#', 'Query', 'Research Goal'],
        ...iter.serpQueries.map((q, i) => [i + 1, q.query, q.researchGoal]),
        ['', ''],
        ['Follow-up Questions Generated (for next iteration)', ''],
        ...iter.followUpQuestions.map((q, i) => [i + 1, q]),
      );
      const iterSheet = XLSX.utils.aoa_to_sheet(iterData);
      XLSX.utils.book_append_sheet(workbook, iterSheet, `Iteration ${iter.iteration}`);
    }

    const summaryPath = path.join(this.getRunDir(), 'comprehensive-summary.xlsx');
    XLSX.writeFile(workbook, summaryPath);

    return summaryPath;
  }
}
