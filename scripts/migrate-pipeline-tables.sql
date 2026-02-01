-- Add pipeline tables if they don't exist (gathered, triaged, filter, scraped)
-- Run this against your Postgres DB (e.g. Railway Data → Query, or psql) so pipeline data is stored.

-- Pipeline iterations (one per research label + iteration)
CREATE TABLE IF NOT EXISTS pipeline_iterations (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL,
    research_label VARCHAR(100),
    iteration INTEGER NOT NULL,
    depth INTEGER NOT NULL,
    query TEXT NOT NULL,
    serp_queries JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Gathered articles (search results before triage)
CREATE TABLE IF NOT EXISTS pipeline_gathered (
    id SERIAL PRIMARY KEY,
    iteration_id INTEGER NOT NULL REFERENCES pipeline_iterations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    snippet TEXT,
    source_queries JSONB DEFAULT '[]',
    item_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Triaged articles (passed triage)
CREATE TABLE IF NOT EXISTS pipeline_triaged (
    id SERIAL PRIMARY KEY,
    iteration_id INTEGER NOT NULL REFERENCES pipeline_iterations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    title TEXT,
    description TEXT,
    snippet TEXT,
    item_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Filter decisions (to scrape vs metadata only)
CREATE TABLE IF NOT EXISTS pipeline_filter (
    id SERIAL PRIMARY KEY,
    iteration_id INTEGER NOT NULL REFERENCES pipeline_iterations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('scrape', 'metadata_only')),
    reason TEXT,
    title TEXT,
    description TEXT,
    item_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Scraped content
CREATE TABLE IF NOT EXISTS pipeline_scraped (
    id SERIAL PRIMARY KEY,
    iteration_id INTEGER NOT NULL REFERENCES pipeline_iterations(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    markdown TEXT,
    error TEXT,
    published_date VARCHAR(50),
    item_order INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pipeline_iterations_run_id ON pipeline_iterations(run_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_iterations_research_label ON pipeline_iterations(research_label);
CREATE INDEX IF NOT EXISTS idx_pipeline_gathered_iteration_id ON pipeline_gathered(iteration_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_triaged_iteration_id ON pipeline_triaged(iteration_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_filter_iteration_id ON pipeline_filter(iteration_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_scraped_iteration_id ON pipeline_scraped(iteration_id);
