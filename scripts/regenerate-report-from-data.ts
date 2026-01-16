// Regenerate report with new card-based format using existing research data
// Reads learnings and URLs from the comprehensive summary Excel file

import { writeFinalReport } from '../src/deep-research';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as XLSX from 'xlsx';

async function regenerateReportFromData() {
  console.log('🔄 Regenerating report with card-based format from existing data...\n');

  const runId = 'research-1768510271573';
  const researchDir = path.join('research-results', runId);
  const summaryPath = path.join(researchDir, 'comprehensive-summary.xlsx');

  // Read the comprehensive summary Excel file
  console.log(`📖 Reading data from: ${summaryPath}\n`);
  
  try {
    const workbook = XLSX.readFile(summaryPath);
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as any[][];

    // Extract initial query
    let initialQuery = '';
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === 'Initial Query') {
        initialQuery = data[i][1] || '';
        break;
      }
    }

    // Extract learnings (starts at row with "All Learnings" header)
    const learnings: string[] = [];
    let inLearningsSection = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === 'All Learnings' || (data[i][0] === '#' && data[i][1] === 'Learning')) {
        inLearningsSection = true;
        continue;
      }
      if (inLearningsSection && data[i][0] && typeof data[i][0] === 'number') {
        const learning = data[i][1];
        if (learning && typeof learning === 'string' && learning.trim()) {
          learnings.push(learning.trim());
        }
      }
      if (inLearningsSection && data[i][0] === 'All Visited URLs') {
        break;
      }
    }

    // Extract visited URLs
    const visitedUrls: string[] = [];
    let inUrlsSection = false;
    for (let i = 0; i < data.length; i++) {
      if (data[i][0] === 'All Visited URLs' || (data[i][0] === '#' && data[i][1] === 'URL')) {
        inUrlsSection = true;
        continue;
      }
      if (inUrlsSection && data[i][0] && typeof data[i][0] === 'number') {
        const url = data[i][1];
        if (url && typeof url === 'string' && url.trim() && url.startsWith('http')) {
          visitedUrls.push(url.trim());
        }
      }
    }

    console.log(`✅ Extracted data:`);
    console.log(`   - Initial Query: ${initialQuery.substring(0, 100)}...`);
    console.log(`   - Learnings: ${learnings.length}`);
    console.log(`   - URLs: ${visitedUrls.length}\n`);

    if (learnings.length === 0) {
      console.log('⚠️  No learnings found in the summary file.');
      return;
    }

    // Generate the new report with card-based format
    console.log('📝 Generating report with new card-based format...\n');
    
    const report = await writeFinalReport({
      prompt: initialQuery,
      learnings,
      visitedUrls,
    });

    // Save the new report
    const outputPath = path.join(researchDir, 'final-report-cards.md');
    await fs.writeFile(outputPath, report, 'utf-8');
    
    console.log(`✅ Report regenerated with card-based format!`);
    console.log(`📄 Saved to: ${outputPath}\n`);
    console.log(`📊 Report preview (first 500 chars):\n${report.substring(0, 500)}...\n`);

  } catch (error) {
    console.error('❌ Error reading data:', error);
    throw error;
  }
}

regenerateReportFromData().catch(console.error);
