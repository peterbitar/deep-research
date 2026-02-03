/**
 * Test holding-checkup for a symbol. Usage: npx tsx --env-file=.env.local scripts/test-holding-checkup.ts PLTR [Palantir]
 */
import '../src/load-env';
import { generateHoldingCheckup } from '../src/investor-checkup';

async function main() {
  const symbol = process.argv[2] || 'BTC';
  const name = process.argv[3] || symbol;
  console.log(`Calling holding-checkup for ${name} (${symbol})...\n`);
  const { checkup, assetType, citationUrls } = await generateHoldingCheckup({
    symbol,
    name: process.argv[3] ? name : undefined,
  });
  console.log('Asset type:', assetType);
  if (citationUrls?.length) console.log('Citations:', citationUrls.length);
  console.log('\n--- Checkup ---\n');
  console.log(checkup);
  console.log('\n--- Done ---');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
