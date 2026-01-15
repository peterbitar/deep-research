// Regenerate report with new prompt style

import * as fs from 'fs/promises';
import { generateText } from 'ai';

import { getModel } from '../src/ai/providers';
import { reportStylePrompt } from '../src/prompt';

async function regenerateReport() {
  console.log('📝 Reading current report...\n');
  
  // Read current report
  const currentReport = await fs.readFile('report.md', 'utf-8');
  
  console.log('✨ Regenerating report with new prompt style...\n');
  
  // Regenerate using new prompt style
  const res = await generateText({
    model: getModel(),
    system: reportStylePrompt(),
    prompt: `Rewrite the following Wealthy Rabbit Daily Intelligence report using the new style guidelines. Keep all the factual information and data points, but rewrite the narrative to match the new style:

${currentReport}

Rewrite the entire report following the new style guidelines while preserving all factual content.`,
  });
  
  // Write back to report.md
  await fs.writeFile('report.md', res.text, 'utf-8');
  
  console.log('✅ Report regenerated and saved to report.md\n');
  console.log('📄 Preview (first 1500 chars):\n');
  console.log(res.text.substring(0, 1500) + '...\n');
}

regenerateReport().catch(console.error);
