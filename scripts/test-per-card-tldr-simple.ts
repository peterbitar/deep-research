// Simple test for per-card TLDR - checks the structure without full rewrite
import { generateObject } from 'ai';
import { z } from 'zod';
import { getModel } from '../src/ai/providers';
import { reportStylePrompt } from '../src/prompt';

// Simple trim function
function trimPrompt(text: string, maxLength?: number): string {
  if (maxLength && text.length > maxLength) {
    return text.substring(0, maxLength);
  }
  return text.trim();
}

async function testPerCardTLDRSimple() {
  console.log('🧪 Testing Per-Card TLDR Structure (Simple)\n');

  // Simulate card selection
  const selectedCards = [
    {
      title: 'Netflix Earnings and Margin Dynamics',
      whyItMatters: 'Shows balance between revenue growth and spending increases',
      actionableValue: 'Helps investors understand margin pressure and future profitability',
      relatedLearnings: ['Q4 earnings', 'program spending increase'],
    },
  ];

  console.log(`📝 Testing with ${selectedCards.length} card(s)\n`);

  // Generate TLDR for the card
  console.log('📋 Generating TLDR for card...');
  const cardTldrRes = await generateObject({
    model: getModel(),
    system: reportStylePrompt(),
    prompt: trimPrompt(
      `Generate a concise TLDR (Too Long; Didn't Read) summary for this specific card/story.

TLDR REQUIREMENTS:
- Write 2-3 bullet points (this is the ONLY place bullets are allowed in the card)
- Each bullet should be 1-2 sentences
- Cover the key points readers will discover in this card's deep dive
- Make it scannable and informative - give readers a quick preview
- Use clear, conversational language
- Focus on what changed and why it matters for THIS specific story
- Don't give away all the details - tease what they'll learn in the full deep dive

CARD DETAILS:
Title: ${selectedCards[0].title}
Why It Matters: ${selectedCards[0].whyItMatters}
Actionable Value: ${selectedCards[0].actionableValue}
Related Learnings: ${selectedCards[0].relatedLearnings.join(', ')}

Generate the TLDR for this card now:`,
    ),
    schema: z.object({
      tldr: z.string().describe('TLDR summary with 2-3 bullet points for this specific card'),
    }),
  });

  const cardTldr = cardTldrRes.object.tldr;
  console.log('✅ TLDR Generated\n');

  // Test the structure
  console.log('='.repeat(60));
  console.log('TLDR STRUCTURE TEST');
  console.log('='.repeat(60));
  console.log(`Card Title: ${selectedCards[0].title}`);
  console.log(`\nTLDR Content:`);
  console.log(cardTldr);
  console.log('\n' + '-'.repeat(60));

  // Check structure
  const hasBullets = /^[-*]\s/.test(cardTldr) || /^\d+\.\s/.test(cardTldr);
  const bulletCount = (cardTldr.match(/^[-*]\s/gm) || []).length;
  const isRightLength = bulletCount >= 2 && bulletCount <= 3;

  console.log(`\n✅ Has bullet points: ${hasBullets ? 'YES' : 'NO'}`);
  console.log(`✅ Bullet count: ${bulletCount} (expected: 2-3)`);
  console.log(`✅ Right length: ${isRightLength ? 'YES' : 'NO'}`);

  // Test full card structure
  const mockCardStructure = `## 🎬 ${selectedCards[0].title}

### TLDR

${cardTldr}

Here's what happened with Netflix this week...`;

  console.log('\n' + '='.repeat(60));
  console.log('FULL CARD STRUCTURE');
  console.log('='.repeat(60));
  console.log(mockCardStructure.substring(0, 500) + '...\n');

  // Verify structure
  const hasCardHeader = /^##\s+/.test(mockCardStructure);
  const hasTLDRHeader = /###\s+TLDR/i.test(mockCardStructure);
  const tldrAfterHeader = mockCardStructure.indexOf('### TLDR') > mockCardStructure.indexOf('##');

  console.log(`✅ Card header (##): ${hasCardHeader ? 'YES' : 'NO'}`);
  console.log(`✅ TLDR header (### TLDR): ${hasTLDRHeader ? 'YES' : 'NO'}`);
  console.log(`✅ TLDR after card header: ${tldrAfterHeader ? 'YES' : 'NO'}`);

  const allGood = hasBullets && isRightLength && hasCardHeader && hasTLDRHeader && tldrAfterHeader;

  console.log(`\n${allGood ? '🎉 SUCCESS: Per-card TLDR structure is correct!' : '❌ FAILED: Structure issues detected'}\n`);

  return { success: allGood, bulletCount, hasTLDR: hasTLDRHeader };
}

testPerCardTLDRSimple()
  .then((result) => {
    process.exit(result.success ? 0 : 1);
  })
  .catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
