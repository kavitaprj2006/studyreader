-- ============================================================
-- Migration 004: Durable Job Queue, pgvector Embeddings & Analytics
-- ============================================================

-- 1. Create document_jobs table for durable background processing
CREATE TABLE IF NOT EXISTS document_jobs (
    id BIGSERIAL PRIMARY KEY,
    pdf_id BIGINT NOT NULL,
    job_type VARCHAR(50) NOT NULL DEFAULT 'process_document',
    status VARCHAR(30) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INT NOT NULL DEFAULT 0,
    max_attempts INT NOT NULL DEFAULT 3,
    progress INT NOT NULL DEFAULT 0
        CHECK (progress >= 0 AND progress <= 100),
    error_message TEXT NULL,
    locked_at TIMESTAMPTZ NULL,
    locked_by VARCHAR(100) NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_document_jobs_pdf
        FOREIGN KEY (pdf_id)
        REFERENCES pdfs(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_document_jobs_status_created
ON document_jobs (status, created_at);

CREATE INDEX IF NOT EXISTS idx_document_jobs_pdf_status
ON document_jobs (pdf_id, status);

-- 2. Ensure metadata JSONB exists on pdf_chunks
ALTER TABLE pdf_chunks
ADD COLUMN IF NOT EXISTS metadata JSONB NULL DEFAULT '{}'::jsonb;

-- 3. Detect and configure vector extension and embedding column
DO $$
DECLARE
    v_available BOOLEAN := FALSE;
BEGIN
    -- Check if pgvector extension is installable
    SELECT EXISTS (
        SELECT 1 FROM pg_available_extensions WHERE name = 'vector'
    ) INTO v_available;

    IF v_available THEN
        BEGIN
            CREATE EXTENSION IF NOT EXISTS vector;
            RAISE NOTICE 'pgvector extension created or already present.';
        EXCEPTION WHEN OTHERS THEN
            RAISE NOTICE 'Could not create vector extension: %', SQLERRM;
            v_available := FALSE;
        END;
    END IF;

    -- If extension exists and type vector is registered
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'pdf_chunks' AND column_name = 'embedding'
        ) THEN
            ALTER TABLE pdf_chunks ADD COLUMN embedding vector(768) NULL;
            RAISE NOTICE 'Added embedding vector(768) to pdf_chunks';
        END IF;
    ELSE
        -- Fallback for environments without pgvector (e.g. local PostgreSQL without binary extension):
        IF NOT EXISTS (
            SELECT 1 FROM information_schema.columns 
            WHERE table_name = 'pdf_chunks' AND column_name = 'embedding'
        ) THEN
            ALTER TABLE pdf_chunks ADD COLUMN embedding double precision[] NULL;
            RAISE NOTICE 'Added embedding double precision[] fallback to pdf_chunks';
        END IF;
    END IF;
END $$;

-- 4. Ensure analytics_events table exists
CREATE TABLE IF NOT EXISTS analytics_events (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NULL,
    event_name VARCHAR(100) NOT NULL,
    entity_type VARCHAR(50) NULL,
    entity_id BIGINT NULL,
    metadata JSONB NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_analytics_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_analytics_event_time
ON analytics_events (event_name, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_user_time
ON analytics_events (user_id, created_at DESC);
