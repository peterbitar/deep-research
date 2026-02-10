/**
 * One-off test: generate one card for a symbol using the finance app.
 * Uses Railway finance app by default; override with FINANCE_APP_URL.
 * Usage: npx tsx scripts/test-card-from-finance.ts [SYMBOL]
 *        FINANCE_APP_URL=http://localhost:3000 npx tsx scripts/test-card-from-finance.ts BTC
 */

import { config } from 'dotenv';
import { existsSync } from 'fs';
import { join } from 'path';

if (existsSync(join(__dirname, '..', '.env.local'))) {
  config({ path: join(__dirname, '..', '.env.local') });
}

import { generateOneCardFromFinance } from '../src/finance-card';

const DEFAULT_FINANCE_APP_URL = 'https://advanced-chat-production.up.railway.app';
const symbol = process.argv[2] || 'BTC';
const baseUrl = (
  process.env.FINANCE_APP_URL !== undefined ? process.env.FINANCE_APP_URL : DEFAULT_FINANCE_APP_URL
).trim();

async function main() {
  console.log(`Generating 1 card for ${symbol} via ${baseUrl || '(default Railway)'}...\n`);
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
