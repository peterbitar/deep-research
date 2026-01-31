-- Database schema for Deep Research API
-- PostgreSQL database schema

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

-- Reports table (stores final-report.md content)
CREATE TABLE IF NOT EXISTS reports (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
    report_markdown TEXT NOT NULL,
    opening TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id)
);

-- Report Cards table (individual cards from reports)
CREATE TABLE IF NOT EXISTS report_cards (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
    title VARCHAR(500) NOT NULL,
    content TEXT NOT NULL,
    emoji VARCHAR(10),
    ticker VARCHAR(20),
    macro VARCHAR(100),
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

-- Research Learnings table (intermediate storage for research results)
CREATE TABLE IF NOT EXISTS research_learnings (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(255) NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
    learning TEXT NOT NULL,
    learning_order INTEGER NOT NULL,
    source_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat Sessions table
CREATE TABLE IF NOT EXISTS chat_sessions (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_accessed TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Chat Messages table
CREATE TABLE IF NOT EXISTS chat_messages (
    id SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL REFERENCES chat_sessions(session_id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    message_order INTEGER NOT NULL
);

-- Cost Logs table (tracks LLM and Firecrawl costs)
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
    run_id VARCHAR(255),
    metadata JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cost_logs_run_id ON cost_logs(run_id);
CREATE INDEX IF NOT EXISTS idx_cost_logs_service ON cost_logs(service);
CREATE INDEX IF NOT EXISTS idx_cost_logs_created_at ON cost_logs(created_at DESC);

-- Indexes for performance
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
CREATE INDEX IF NOT EXISTS idx_research_learnings_run_id ON research_learnings(run_id);
