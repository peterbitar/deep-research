// Regenerate report with new prompt style

import * as fs from 'fs/promises';
import { generateText } from 'ai';

import { getModel } from '../src/ai/providers';
import { reportStylePrompt } from '../src/prompt';

async function regenerateReport() {
  console.log('📝 Regenerating report with new prompt style...\n');
  
  // Read current report
  const currentReport = await fs.readFile('report.md', 'utf-8');
  
  // Extract the body (skip the header)
  const reportBody = currentReport.replace(/^#.*?\n\n---\n\n/s, '');
  
  // Regenerate using new prompt style
  const res = await generateText({
    model: getModel(),
    system: reportStylePrompt(),
    prompt: `Rewrite the following Wealthy Rabbit Daily Intelligence report using the new style guidelines. Keep all factual information and data, but rewrite the narrative to match the new style:

${reportBody}

Rewrite the complete report following the new style guidelines.`,
  });
  
  // Get the date from original report
  const dateMatch = currentReport.match(/\*([^*]+)\*/);
  const dateStr = dateMatch ? dateMatch[1] : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  
  // Write back to report.md
  const newReport = `# Wealthy Rabbit Daily Intelligence
*${dateStr}*

---

${res.text}`;
  
  await fs.writeFile('report.md', newReport, 'utf-8');
  
  console.log('✅ Report regenerated and saved to report.md\n');
}

regenerateReport().catch(console.error);
