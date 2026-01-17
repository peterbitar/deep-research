// Script to rewrite an existing report's card content to be more human-like

import * as fs from 'fs/promises';
import * as path from 'path';
import { rewriteCardContent } from '../src/deep-research';

async function rewriteReport() {
  const reportPath = process.argv[2];
  
  if (!reportPath) {
    console.error('Usage: npx tsx scripts/rewrite-report.ts <path-to-report.md>');
    console.error('Example: npx tsx scripts/rewrite-report.ts research-results/research-1768628074378/final-report.md');
    process.exit(1);
  }

  try {
    console.log(`📖 Reading report from: ${reportPath}`);
    const reportMarkdown = await fs.readFile(reportPath, 'utf-8');
    
    console.log('✍️  Rewriting card content for human-like authenticity...');
    const rewrittenReport = await rewriteCardContent(reportMarkdown);
    
    // Save the rewritten report
    const backupPath = reportPath.replace('.md', '.original.md');
    await fs.writeFile(backupPath, reportMarkdown, 'utf-8');
    console.log(`💾 Original report backed up to: ${backupPath}`);
    
    await fs.writeFile(reportPath, rewrittenReport, 'utf-8');
    console.log(`✅ Rewritten report saved to: ${reportPath}`);
    
  } catch (error) {
    console.error('❌ Error rewriting report:', error);
    process.exit(1);
  }
}

rewriteReport().catch(console.error);
