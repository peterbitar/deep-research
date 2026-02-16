// PostgreSQL database client
import pg from 'pg';
import { createRequire } from 'module';

const { Pool } = pg;

// Load .env.local before reading DATABASE_URL (so script imports don't read env too early)
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

// Get database URL from environment
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.warn('⚠️  DATABASE_URL not set. Database features will be disabled.');
}

// Create connection pool
export const pool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    })
  : null;

// Test database connection
export async function testConnection(): Promise<boolean> {
  if (!pool) {
    console.warn('Database pool not initialized');
    return false;
  }

  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    return false;
  }
}

// Initialize database schema
export async function initializeSchema(): Promise<void> {
  if (!pool) {
    console.warn('Database pool not initialized. Skipping schema initialization.');
    return;
  }

  try {
    // Try to read schema file first
    const fs = await import('fs/promises');
    const path = await import('path');
    
    try {
      const schemaPath = path.join(process.cwd(), 'src', 'db', 'schema.sql');
      const schemaSQL = await fs.readFile(schemaPath, 'utf-8');
      await pool.query(schemaSQL);
      console.log('✅ Database schema initialized from file');
      return;
    } catch (fileError) {
      // File not found, use inline schema
      console.log('Schema file not found, creating schema inline...');
    }
  } catch (error) {
    console.log('Trying inline schema creation...');
  }

  // Fallback: Create schema inline
  await createSchemaInline();
}

// Create schema inline
async function createSchemaInline(): Promise<void> {
  if (!pool) return;

  const schemaSQL = `
-- Research Runs table
CREATE TABLE IF NOT EXISTS research_runs (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(255) UNIQUE NOT NULL,
    query TEXT NOT NULL,
    depth INTEGER DEFAULT 3,
    breadth INTEGER DEFAULT 3,
    status VARCHAR(50) DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
    report_markdown TEXT NOT NULL,
    opening TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id)
);

-- Report Cards table
CREATE TABLE IF NOT EXISTS report_cards (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    emoji VARCHAR(10),
    ticker VARCHAR(20),
    macro VARCHAR(100),
    event_type VARCHAR(100),
    card_order INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Report Sources table
CREATE TABLE IF NOT EXISTS report_sources (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
    source_url TEXT NOT NULL,
    source_order INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- News brief progress: one row per holding per run (mark complete after each holding)
CREATE TABLE IF NOT EXISTS news_brief_holdings (
    run_id VARCHAR(255) NOT NULL,
    symbol VARCHAR(20) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'completed',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (run_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_news_brief_holdings_run_id ON news_brief_holdings(run_id);

-- Chat Sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Pipeline iterations
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
CREATE INDEX IF NOT EXISTS idx_pipeline_gathered_iteration_id ON pipeline_gathered(iteration_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_triaged_iteration_id ON pipeline_triaged(iteration_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_filter_iteration_id ON pipeline_filter(iteration_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_scraped_iteration_id ON pipeline_scraped(iteration_id);

-- Cost Logs table (Firecrawl: usage_credits + total_cost; OpenAI: tokens + total_cost)
CREATE TABLE IF NOT EXISTS cost_logs (
    id SERIAL PRIMARY KEY,
    service VARCHAR(50) NOT NULL,
    operation VARCHAR(100) NOT NULL,
    model VARCHAR(100),
    input_tokens INTEGER,
    output_tokens INTEGER,
    count INTEGER DEFAULT 1,
    cost_per_unit DECIMAL(12, 6),
    total_cost DECIMAL(12, 6) NOT NULL,
    usage_credits INTEGER,
    run_id VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cost_logs_run_id ON cost_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_cost_logs_service ON cost_logs(service);
CREATE INDEX IF NOT EXISTS idx_cost_logs_created_at ON cost_logs(created_at DESC);

-- Chat Messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_order INTEGER NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_research_runs_run_id ON research_runs(run_id);
CREATE INDEX IF NOT EXISTS idx_research_runs_created_at ON research_runs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_run_id ON reports(run_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_run_id ON report_cards(run_id);
CREATE INDEX IF NOT EXISTS idx_report_cards_ticker ON report_cards(ticker);
CREATE INDEX IF NOT EXISTS idx_report_cards_macro ON report_cards(macro);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_session_id ON chat_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_accessed ON chat_sessions(last_accessed);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id ON chat_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created_at ON chat_messages(created_at);
`;

  try {
    await pool.query(schemaSQL);
    console.log('✅ Database schema created inline');
  } catch (error: any) {
    // Ignore "already exists" errors
    if (!error.message?.includes('already exists')) {
      throw error;
    }
  }
}
