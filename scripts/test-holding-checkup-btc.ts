/**
 * One-off test: call holding-checkup for BTC and print the result.
 * Run: npx tsx --env-file=.env.local scripts/test-holding-checkup-btc.ts
 */
import '../src/load-env';
import { generateHoldingCheckup } from '../src/investor-checkup';

async function main() {
  console.log('Calling holding-checkup for BTC (crypto)...\n');
  const { checkup, assetType } = await generateHoldingCheckup({
    symbol: 'BTC',
    type: 'crypto',
    name: 'Bitcoin',
  });
  console.log('Asset type:', assetType);
  console.log('\n--- Checkup ---\n');
  console.log(checkup);
  console.log('\n--- Done ---');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
