/**
 * Smart Start Script
 *
 * Detects if running in cron mode (via RAILWAY_CRON env var) and runs the right command:
 * - If RAILWAY_CRON=news-brief: runs news-brief pipeline (OpenAI web search → cards)
 * - If RAILWAY_CRON=true (or RUN_PIPELINE=true): runs full pipeline
 * - Otherwise: runs API server
 *
 * Usage:
 *   npm start (runs this script)
 */

async function runCronCommand(command: string, label: string): Promise<void> {
  const { spawn } = await import('child_process');
  const path = await import('path');

  await new Promise<void>((resolve, reject) => {
    const child = spawn('npm', ['run', command], {
      env: process.env,
      stdio: 'inherit',
      cwd: path.resolve(__dirname, '..'),
    });

    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

async function main() {
  const cronMode = process.env.RAILWAY_CRON;
  const runPipeline = process.env.RUN_PIPELINE === 'true';

  if (cronMode === 'news-brief') {
    console.log('🕐 Cron mode: news-brief — running OpenAI web search pipeline...\n');
    try {
      await runCronCommand('news-brief', 'News brief');
      process.exit(0);
    } catch (error: any) {
      console.error('News brief failed:', error?.message ?? error);
      process.exit(1);
    }
  } else if (cronMode === 'true' || runPipeline) {
    console.log('🕐 Cron mode: full pipeline (output streams in real-time)...\n');
    try {
      await runCronCommand('full-pipeline', 'Pipeline');
      process.exit(0);
    } catch (error: any) {
      console.error('Pipeline failed:', error?.message ?? error);
      process.exit(1);
    }
  } else {
    console.log('🚀 Starting API server...\n');
    await import('../src/api.ts');
  }
}

main().catch((e) => {
  console.error('Start script error:', e);
  process.exit(1);
});
