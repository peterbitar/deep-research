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
    console.log('🕐 Cron mode detected - running full pipeline...\n');
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execAsync = promisify(exec);
    
    try {
      const { stdout, stderr } = await execAsync('npm run full-pipeline', {
        env: process.env,
        maxBuffer: 10 * 1024 * 1024,
      });
      
      if (stdout) console.log(stdout);
      if (stderr) console.error(stderr);
      
      process.exit(0);
    } catch (error: any) {
      console.error('Pipeline failed:', error.message);
      if (error.stdout) console.log('STDOUT:', error.stdout);
      if (error.stderr) console.error('STDERR:', error.stderr);
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
