/**
 * Smart Start Script
 * 
 * Detects if running in cron mode (via RAILWAY_CRON env var) and runs appropriate command:
 * - If RAILWAY_CRON=true: runs full pipeline
 * - Otherwise: runs API server
 * 
 * Usage:
 *   npm start (runs this script)
 */

async function main() {
  const isCron = process.env.RAILWAY_CRON === 'true' || process.env.RUN_PIPELINE === 'true';
  
  if (isCron) {
    console.log('🕐 Cron mode detected - running full pipeline (output streams in real-time)...\n');
    const { spawn } = await import('child_process');
    const path = await import('path');

    try {
      await new Promise<void>((resolve, reject) => {
        const child = spawn('npm', ['run', 'full-pipeline'], {
          env: process.env,
          stdio: 'inherit',
          cwd: path.resolve(__dirname, '..'),
        });

        child.on('close', (code) => {
          if (code === 0) resolve();
          else reject(new Error(`Pipeline exited with code ${code}`));
        });
        child.on('error', reject);
      });
      process.exit(0);
    } catch (error: any) {
      console.error('Pipeline failed:', error?.message ?? error);
      process.exit(1);
    }
  } else {
    console.log('🚀 Starting API server...\n');
    // Import and run the API
    await import('../src/api.ts');
  }
}

main().catch((e) => {
  console.error('Start script error:', e);
  process.exit(1);
});
