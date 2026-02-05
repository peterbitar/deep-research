/**
 * One-off test: generate one card for a symbol using the finance app.
 * Usage: FINANCE_APP_URL=http://localhost:3000 npx tsx scripts/test-card-from-finance.ts BTC
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

if (existsSync(join(__dirname, '..', '.env.local'))) {
  config({ path: join(__dirname, '..', '.env.local') });
}

import { generateOneCardFromFinance } from '../src/finance-card';

const symbol = process.argv[2] || 'BTC';
const baseUrl = (process.env.FINANCE_APP_URL || '').trim();

async function main() {
  if (!baseUrl) {
    console.error('Set FINANCE_APP_URL (e.g. http://localhost:3000)');
    process.exit(1);
  }
  console.log(`Generating 1 card for ${symbol} via ${baseUrl}...\n`);
  const card = await generateOneCardFromFinance(symbol);
  if (!card) {
    console.error('Failed to get card (check finance app is running and /api/chat/external works)');
    process.exit(1);
  }
  console.log('Title:', card.title);
  console.log('Emoji:', card.emoji);
  console.log('Content:', card.content);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
