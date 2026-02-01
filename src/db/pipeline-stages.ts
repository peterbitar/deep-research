/**
 * Save pipeline stage data (gathered, triaged, filter, scraped) to DB
 */

import { pool } from './client';

type GatheredArticle = {
  url: string;
  title?: string;
  description?: string;
  snippet?: string;
  sourceQueries?: string[];
  researchGoals?: string[];
};

type TriagedArticle = { url: string; title?: string; description?: string; snippet?: string };

type ToScrapeItem = { url: string; reason: string };

type MetadataOnlyItem = {
  url: string;
  title?: string;
  description?: string;
  reason: string;
};

type ScrapedItem = {
  url: string;
  markdown?: string;
  error?: string;
  publishedDate?: string;
};

export type PipelineIterationInput = {
  runId: string;
  researchLabel?: string;
  iteration: number;
  depth: number;
  query: string;
  serpQueries: Array<{ query: string; researchGoal: string }>;
  gatheredArticles: GatheredArticle[];
  triagedArticles: TriagedArticle[];
  toScrape: ToScrapeItem[];
  metadataOnly: MetadataOnlyItem[];
  scrapedContent: ScrapedItem[];
};

export async function savePipelineIteration(data: PipelineIterationInput): Promise<number | null> {
  if (!pool) return null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const iterRes = await client.query(
      `INSERT INTO pipeline_iterations (run_id, research_label, iteration, depth, query, serp_queries)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        data.runId,
        data.researchLabel ?? null,
        data.iteration,
        data.depth,
        data.query,
        JSON.stringify(data.serpQueries),
      ]
    );
    const iterationId = iterRes.rows[0]?.id;
    if (!iterationId) throw new Error('Failed to insert pipeline_iterations');

    // Gathered
    for (let i = 0; i < data.gatheredArticles.length; i++) {
      const a = data.gatheredArticles[i];
      await client.query(
        `INSERT INTO pipeline_gathered (iteration_id, url, title, description, snippet, source_queries, item_order)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          iterationId,
          a.url,
          a.title ?? null,
          a.description ?? null,
          a.snippet ?? null,
          JSON.stringify((a as any).sourceQueries ?? (a as any).researchGoals ?? []),
          i,
        ]
      );
    }

    // Triaged
    for (let i = 0; i < data.triagedArticles.length; i++) {
      const a = data.triagedArticles[i];
      await client.query(
        `INSERT INTO pipeline_triaged (iteration_id, url, title, description, snippet, item_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [iterationId, a.url, a.title ?? null, a.description ?? null, a.snippet ?? null, i]
      );
    }

    // Filter: toScrape
    for (let i = 0; i < data.toScrape.length; i++) {
      const a = data.toScrape[i];
      await client.query(
        `INSERT INTO pipeline_filter (iteration_id, url, decision, reason, item_order)
         VALUES ($1, $2, 'scrape', $3, $4)`,
        [iterationId, a.url, a.reason, i]
      );
    }

    // Filter: metadataOnly
    for (let i = 0; i < data.metadataOnly.length; i++) {
      const a = data.metadataOnly[i];
      await client.query(
        `INSERT INTO pipeline_filter (iteration_id, url, decision, reason, title, description, item_order)
         VALUES ($1, $2, 'metadata_only', $3, $4, $5, $6)`,
        [
          iterationId,
          a.url,
          a.reason,
          a.title ?? null,
          a.description ?? null,
          data.toScrape.length + i,
        ]
      );
    }

    // Scraped
    for (let i = 0; i < data.scrapedContent.length; i++) {
      const a = data.scrapedContent[i];
      await client.query(
        `INSERT INTO pipeline_scraped (iteration_id, url, markdown, error, published_date, item_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          iterationId,
          a.url,
          a.markdown ?? null,
          a.error ?? null,
          a.publishedDate ?? null,
          i,
        ]
      );
    }

    await client.query('COMMIT');
    return iterationId;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[pipeline-stages] Failed to save iteration:', err);
    return null;
  } finally {
    client.release();
  }
}

export async function getPipelineIterations(runId: string) {
  if (!pool) return [];
  const res = await pool.query(
    `SELECT id, run_id, research_label, iteration, depth, query, serp_queries, created_at
     FROM pipeline_iterations WHERE run_id = $1 ORDER BY research_label, iteration`,
    [runId]
  );
  return res.rows;
}

export async function getPipelineStageData(
  iterationId: number,
  stage: 'gathered' | 'triaged' | 'filter' | 'scraped'
) {
  if (!pool) return [];
  const table = `pipeline_${stage}`;
  const res = await pool.query(`SELECT * FROM ${table} WHERE iteration_id = $1 ORDER BY item_order`, [
    iterationId,
  ]);
  return res.rows;
}
