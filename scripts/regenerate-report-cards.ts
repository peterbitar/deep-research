// Regenerate report with new card-based format
// Uses existing learnings from a previous research run

import { writeFinalReport } from '../src/deep-research';
import * as fs from 'fs/promises';
import * as path from 'path';

async function regenerateReport() {
  console.log('🔄 Regenerating report with card-based format...\n');

  // Read the existing report to get the prompt (or use a default)
  const reportPath = 'research-results/research-1768510271573/final-report.md';
  
  try {
    const existingReport = await fs.readFile(reportPath, 'utf-8');
    console.log('📄 Found existing report\n');
  } catch (error) {
    console.log('⚠️  No existing report found, using default query\n');
  }

  // For now, use a simple query - in production, you'd extract this from the research run
  const prompt = `Research the current week's developments for this portfolio: BTC (Cryptocurrency), XRP (Cryptocurrency), Silver (Commodity), Gold (Commodity), Oil (Commodity), REIT (Real Estate), NVIDIA (Stock), AAPL (Stock). 

Consider both:
1. Individual holding-specific news (earnings, filings, price movements, supply/demand for commodities, protocol updates for crypto)
2. Macro factors that could impact these holdings (Fed policy, inflation data, currency movements, geopolitical events, economic indicators)

Focus on factual updates from the last 7 days that could impact portfolio performance.`;

  // Read learnings from the comprehensive summary or iteration data
  // For now, we'll need to extract from the research run
  // This is a simplified version - in production, you'd read from the saved data
  console.log('📝 Generating report with card-based format...\n');
  
  // Note: This script assumes you'll provide learnings and URLs
  // In a real scenario, you'd read these from the saved research data
  const learnings: string[] = []; // Would be populated from saved data
  const visitedUrls: string[] = []; // Would be populated from saved data

  if (learnings.length === 0) {
    console.log('⚠️  No learnings found. Please run a research first or provide learnings.');
    return;
  }

  const report = await writeFinalReport({
    prompt,
    learnings,
    visitedUrls,
  });

  // Save the new report
  const outputPath = 'research-results/research-1768510271573/final-report-cards.md';
  await fs.writeFile(outputPath, report, 'utf-8');
  
  console.log(`✅ Report regenerated with card-based format!`);
  console.log(`📄 Saved to: ${outputPath}\n`);
}

regenerateReport().catch(console.error);
