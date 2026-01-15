// Wealthy Rabbit report generation - holdings-based structured format

import { generateText } from 'ai';

import { getModel } from './ai/providers';
import { reportStylePrompt } from './prompt';
import type { Holding } from './holdings';
import { getAssetName } from './holdings';

export interface HoldingResult {
  holding: Holding;
  learnings: string[];
  visitedUrls: string[];
  hasFactualUpdates: boolean;
}

/**
 * Generate Wealthy Rabbit report with per-holding sections
 */
export async function writeWealthyRabbitReport({
  holdingsResults,
  macroLearnings,
  macroUrls,
}: {
  holdingsResults: HoldingResult[];
  macroLearnings?: string[];
  macroUrls?: string[];
}): Promise<string> {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  
  const holdingsWithUpdates = holdingsResults.filter(r => r.hasFactualUpdates);
  const holdingsWithoutUpdates = holdingsResults.filter(r => !r.hasFactualUpdates);
  
  const learningsByHolding = holdingsResults.map(r => {
    const name = getAssetName(r.holding);
    const emoji = r.holding.type === 'stock' ? '📊' : r.holding.type === 'crypto' ? '₿' : '🏭';
    return {
      symbol: r.holding.symbol,
      name,
      emoji,
      type: r.holding.type,
      hasUpdates: r.hasFactualUpdates,
      learnings: r.learnings,
    };
  });
  
  const learningsText = learningsByHolding
    .map(h => `${h.emoji} ${h.symbol} (${h.name}):\n${h.learnings.join('\n')}`)
    .join('\n\n');
  
  const res = await generateText({
    model: getModel(),
    system: reportStylePrompt(),
    prompt: `Generate a Wealthy Rabbit daily intelligence report with per-holding sections.

HOLDINGS DATA:
${learningsText}

STRUCTURE:
- Create a section for each holding
- For holdings WITH updates: Status ✅ Changed, list factual updates, explain what it means for holders, what didn't change
- For holdings WITHOUT updates: Status ❌ No new factual developments. Narrative unchanged.
- Use Wealthy Rabbit style: conversational, calm, teaching, simple language
- Each holding should be clearly separated

${macroLearnings && macroLearnings.length > 0 ? `MACRO DATA:\n${macroLearnings.join('\n')}\n\nInclude a "Macro & Liquidity Scan" section.` : ''}

Include a Summary section listing which holdings changed, which didn't, and overall backdrop.

Write the complete report in Wealthy Rabbit style.`,
  });
  
  const header = `# Wealthy Rabbit Daily Intelligence
*${dateStr}*

---

`;
  
  return header + res.text;
}
