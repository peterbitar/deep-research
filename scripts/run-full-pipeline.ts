/**
 * Full Pipeline Runner
 * 
 * Runs all 3 scripts in sequence:
 * 1. Research only (fetch holdings, research, save learnings)
 * 2. Generate report (from learnings)
 * 3. Rewrite report (refine content)
 * 
 * Usage:
 *   npm run full-pipeline
 *   # or
 *   npx tsx --env-file=.env.local scripts/run-full-pipeline.ts
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

async function runCommand(command: string, description: string): Promise<void> {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🚀 ${description}`);
  console.log(`${'='.repeat(60)}\n`);
  
  try {
    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env },
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });
    
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    
    console.log(`\n✅ ${description} completed successfully\n`);
  } catch (error: any) {
    console.error(`\n❌ ${description} failed:`);
    console.error(error.message);
    if (error.stdout) console.log('STDOUT:', error.stdout);
    if (error.stderr) console.error('STDERR:', error.stderr);
    throw error;
  }
}

// Convert Railway internal hostname to public hostname if running locally
function getPublicDatabaseUrl(): string | undefined {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) return undefined;
  
  // If running locally and using Railway internal hostname, convert to public
  // Railway internal: postgres-4cvn.railway.internal
  // Railway public: containers-us-west-xxx.railway.app (or similar)
  if (dbUrl.includes('.railway.internal')) {
    console.warn('⚠️  Detected Railway internal hostname. This only works inside Railway network.');
    console.warn('   For local runs, use the public connection string from Railway dashboard.');
    console.warn('   Go to: Railway → Postgres → Connect → Public Network → Copy connection string');
    throw new Error(
      'DATABASE_URL uses Railway internal hostname. ' +
      'For local runs, use the public connection string from Railway dashboard. ' +
      'Or run this via Railway Cron (which will use the internal hostname automatically).'
    );
  }
  
  return dbUrl;
}

async function main() {
  console.log('\n📋 Full Pipeline Runner');
  console.log('This will run: research-only → generate-report → rewrite-report\n');
  
  const dbUrl = getPublicDatabaseUrl();
  if (!dbUrl) {
    throw new Error('DATABASE_URL is required. Set it in Railway environment variables or .env.local');
  }

  const startTime = Date.now();

  try {
    // Step 1: Research
    await runCommand(
      'npx tsx --env-file=.env.local scripts/1-research-only.ts',
      'Step 1: Research Only'
    );

    // Step 2: Generate Report
    await runCommand(
      'npx tsx --env-file=.env.local scripts/2-generate-report.ts',
      'Step 2: Generate Report'
    );

    // Step 3: Rewrite Report
    await runCommand(
      'npx tsx --env-file=.env.local scripts/3-rewrite-report.ts',
      'Step 3: Rewrite Report'
    );

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log(`\n${'='.repeat(60)}`);
    console.log(`✅ Full pipeline completed successfully!`);
    console.log(`⏱️  Total time: ${elapsed} minutes`);
    console.log(`${'='.repeat(60)}\n`);
  } catch (error) {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.error(`\n${'='.repeat(60)}`);
    console.error(`❌ Pipeline failed after ${elapsed} minutes`);
    console.error(`${'='.repeat(60)}\n`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
