/**
 * Load .env.local / .env for local dev when env vars are not already set.
 * On Railway, DATABASE_URL and other vars are set in the dashboard — we do not load any file.
 * Run this first in api.ts so cost logging and DB work whether you use `tsx src/api.ts` or Railway.
 */
import { createRequire } from 'module';

if (!process.env.DATABASE_URL) {
  try {
    const require = createRequire(import.meta.url);
    const path = require('path');
    const fs = require('fs');
    const dotenv = require('dotenv');
    const cwd = process.cwd();
    for (const name of ['.env.local', '.env']) {
      const envPath = path.join(cwd, name);
      if (fs.existsSync(envPath)) {
        dotenv.config({ path: envPath });
        break;
      }
    }
  } catch (_) {
    // ignore
  }
}
