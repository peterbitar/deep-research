/**
 * Full Pipeline Runner
 *
 * Runs all 3 scripts in sequence:
 * 1. Research only (fetch holdings, research, save learnings)
 * 2. Generate report (from learnings)
 * 3. Rewrite report (refine content)
 *
 * Uses spawn with stdio: 'inherit' so child output streams in real-time
 * (no buffering — you see progress as it happens).
 *
 * Usage:
 *   npm run full-pipeline
 *   # or
 *   npx tsx --env-file=.env.local scripts/run-full-pipeline.ts
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';

/** Use --env-file=.env.local only when file exists (Railway has no .env.local) */
const envFileArg = existsSync('.env.local') ? '--env-file=.env.local' : '';

function runCommand(scriptArgs: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = ['tsx', ...(envFileArg ? [envFileArg] : []), ...scriptArgs];
    const child = spawn('npx', args, {
      env: { ...process.env },
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        const err = new Error(
          `Command failed: npx ${args.join(' ')} (code=${code}, signal=${signal})`
        ) as Error & { code?: number };
        err.code = code ?? undefined;
        reject(err);
      }
    });

    child.on('error', reject);
  });
}

async function main() {
  const startTime = Date.now();

  console.log('\n' + '='.repeat(60));
  console.log('📋 FULL PIPELINE — STARTING');
  console.log('='.repeat(60));
  console.log('Steps: 1) Research (~15–20 min) → 2) Generate (~3 min) → 3) Rewrite (~2–5 min)');
  console.log('Expected total: ~25 min. Output streams in real-time.\n');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required. Set it in Railway environment variables or .env.local');
  }

  // If you hit Railway's 500 logs/sec limit, set LOG_LEVEL=warn to reduce volume.
  // Streaming output (spawn + stdio: inherit) spreads logs over time and usually avoids bursts.

  try {
    console.log('\n' + '='.repeat(60));
    console.log('🚀 Step 1: Research Only');
    console.log('='.repeat(60) + '\n');
    await runCommand(['scripts/1-research-only.ts']);
    console.log('\n✅ Step 1: Research Only — completed\n');

    console.log('\n' + '='.repeat(60));
    console.log('🚀 Step 2: Generate Report');
    console.log('='.repeat(60) + '\n');
    await runCommand(['scripts/2-generate-report.ts']);
    console.log('\n✅ Step 2: Generate Report — completed\n');

    console.log('\n' + '='.repeat(60));
    console.log('🚀 Step 3: Rewrite Report');
    console.log('='.repeat(60) + '\n');
    await runCommand(['scripts/3-rewrite-report.ts']);
    console.log('\n✅ Step 3: Rewrite Report — completed\n');

    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.log('\n' + '='.repeat(60));
    console.log('✅ FULL PIPELINE — SUCCESS');
    console.log(`⏱️  Total time: ${elapsed} minutes`);
    console.log('='.repeat(60) + '\n');
  } catch (error: any) {
    const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
    console.error('\n' + '='.repeat(60));
    console.error('❌ FULL PIPELINE — FAILED');
    console.error(`⏱️  Failed after ${elapsed} minutes`);
    console.error(`Error: ${error?.message ?? error}`);
    console.error('='.repeat(60) + '\n');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
