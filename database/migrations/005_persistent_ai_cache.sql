-- ============================================================
-- Migration 005: Persistent AI Summary & Answer Caching
-- ============================================================

-- 1. AI Summary Cache Table
CREATE TABLE IF NOT EXISTS ai_summary_cache (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL,
    summary_type VARCHAR(50) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    prompt_version VARCHAR(20) NOT NULL DEFAULT 'v1',
    model VARCHAR(100) NULL,
    provider VARCHAR(50) NULL,
    summary_text TEXT NOT NULL,
    sources JSONB DEFAULT '[]'::jsonb,
    hit_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_summary_cache_pdf
        FOREIGN KEY (document_id)
        REFERENCES pdfs(id)
        ON DELETE CASCADE,
    CONSTRAINT uq_summary_cache
        UNIQUE (document_id, summary_type, content_hash, prompt_version)
);

CREATE INDEX IF NOT EXISTS idx_summary_cache_lookup
ON ai_summary_cache (document_id, summary_type, content_hash, prompt_version);

CREATE INDEX IF NOT EXISTS idx_summary_cache_doc
ON ai_summary_cache (document_id);

-- 2. AI Answer Cache Table
CREATE TABLE IF NOT EXISTS ai_answer_cache (
    id BIGSERIAL PRIMARY KEY,
    document_id BIGINT NOT NULL,
    question_hash VARCHAR(64) NOT NULL,
    normalized_question TEXT NOT NULL,
    context_fingerprint VARCHAR(64) NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    prompt_version VARCHAR(20) NOT NULL DEFAULT 'v1',
    model VARCHAR(100) NULL,
    provider VARCHAR(50) NULL,
    answer_text TEXT NOT NULL,
    sources JSONB DEFAULT '[]'::jsonb,
    hit_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMPTZ NOT NULL DEFAULT (CURRENT_TIMESTAMP + INTERVAL '14 days'),
    CONSTRAINT fk_answer_cache_pdf
        FOREIGN KEY (document_id)
        REFERENCES pdfs(id)
        ON DELETE CASCADE,
    CONSTRAINT uq_answer_cache
        UNIQUE (document_id, question_hash, context_fingerprint, content_hash, prompt_version)
);

CREATE INDEX IF NOT EXISTS idx_answer_cache_lookup
ON ai_answer_cache (document_id, question_hash, context_fingerprint, content_hash, prompt_version);

CREATE INDEX IF NOT EXISTS idx_answer_cache_doc
ON ai_answer_cache (document_id);

-- 3. AI Cache Aggregate Statistics Table
CREATE TABLE IF NOT EXISTS ai_cache_stats (
    id SERIAL PRIMARY KEY,
    metric_name VARCHAR(50) UNIQUE NOT NULL,
    metric_value BIGINT NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO ai_cache_stats (metric_name, metric_value)
VALUES
    ('summary_hits', 0),
    ('summary_misses', 0),
    ('answer_hits', 0),
    ('answer_misses', 0)
ON CONFLICT (metric_name) DO NOTHING;

-- Record in migration_history if table exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'migration_history') THEN
        INSERT INTO migration_history (migration_name, applied_at)
        VALUES ('005_persistent_ai_cache.sql', CURRENT_TIMESTAMP)
        ON CONFLICT DO NOTHING;
    END IF;
END $$;
