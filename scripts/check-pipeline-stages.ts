/**
 * Check pipeline stages for a run - gathered, triaged, filter, scraped
 *
 * Usage: npx tsx --env-file=.env.local scripts/check-pipeline-stages.ts [runId]
 * If runId omitted, uses latest from pipeline_iterations
 */

import { pool } from '../src/db/client';
import { getPipelineIterations, getPipelineStageData } from '../src/db/pipeline-stages';

async function main() {
  const runId = process.argv[2];

  if (!pool) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }

  let targetRunId = runId;
  if (!targetRunId) {
    const res = await pool.query(
      `SELECT run_id FROM pipeline_iterations ORDER BY created_at DESC LIMIT 1`
    );
    targetRunId = res.rows[0]?.run_id;
    if (!targetRunId) {
      console.error('No pipeline data found. Run research-first to generate data.');
      process.exit(1);
    }
    console.log(`Using latest run: ${targetRunId}\n`);
  }

  const iterations = await getPipelineIterations(targetRunId);
  if (iterations.length === 0) {
    console.log(`No pipeline data for run ${targetRunId}`);
    process.exit(0);
  }

  console.log(`📋 Pipeline stages for ${targetRunId}\n`);
  console.log(`Found ${iterations.length} iteration(s)\n`);

  for (const iter of iterations) {
    console.log(`--- ${iter.research_label || 'Main'} (iteration ${iter.iteration}) ---`);
    console.log(`Query: ${iter.query.slice(0, 80)}...`);
    console.log(`SERP queries: ${(iter.serp_queries as any[])?.length ?? 0}\n`);

    const gathered = await getPipelineStageData(iter.id, 'gathered');
    const triaged = await getPipelineStageData(iter.id, 'triaged');
    const filter = await getPipelineStageData(iter.id, 'filter');
    const scraped = await getPipelineStageData(iter.id, 'scraped');

    console.log(`  Gathered: ${gathered.length} articles`);
    gathered.slice(0, 3).forEach((g, i) => {
      console.log(`    ${i + 1}. ${g.title?.slice(0, 50) || g.url.slice(0, 50)}...`);
    });
    if (gathered.length > 3) console.log(`    ...`);

    console.log(`  Triaged: ${triaged.length} (passed)`);
    console.log(`  Filter: ${filter.filter((f: any) => f.decision === 'scrape').length} to scrape, ${filter.filter((f: any) => f.decision === 'metadata_only').length} metadata-only`);
    console.log(`  Scraped: ${scraped.length} with content\n`);
  }

  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
