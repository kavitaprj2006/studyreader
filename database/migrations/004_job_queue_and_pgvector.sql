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
    col_type TEXT;
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

    -- Inspect current embedding column type on pdf_chunks
    SELECT data_type INTO col_type
    FROM information_schema.columns 
    WHERE table_name = 'pdf_chunks' AND column_name = 'embedding';

    -- If extension exists and type vector is registered
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'vector') THEN
        IF col_type IS NULL THEN
            ALTER TABLE pdf_chunks ADD COLUMN embedding vector(768) NULL;
            RAISE NOTICE 'Added embedding vector(768) to pdf_chunks';
        ELSIF col_type = 'ARRAY' THEN
            -- Convert double precision[] to vector(768) while preserving all existing values
            ALTER TABLE pdf_chunks ALTER COLUMN embedding TYPE vector(768) 
            USING (replace(replace(embedding::text, '{', '['), '}', ']'))::vector;
            RAISE NOTICE 'Safely converted existing embedding ARRAY to vector(768) on pdf_chunks';
        END IF;

        -- Create vector cosine distance index if possible
        BEGIN
            EXECUTE 'CREATE INDEX IF NOT EXISTS idx_pdf_chunks_embedding_cosine ON pdf_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);';
        EXCEPTION WHEN OTHERS THEN
            -- In empty tables or without enough samples, IVFFlat creation can be deferred
            NULL;
        END;
    ELSE
        -- Fallback for environments without pgvector (e.g. local PostgreSQL without binary extension):
        IF col_type IS NULL THEN
            ALTER TABLE pdf_chunks ADD COLUMN embedding double precision[] NULL;
            RAISE NOTICE 'Added embedding double precision[] fallback to pdf_chunks';
        END IF;

        -- Enforce 768 dimensions for fallback arrays
        IF NOT EXISTS (
            SELECT 1 FROM pg_constraint WHERE conname = 'chk_pdf_chunks_embedding_dim'
        ) THEN
            ALTER TABLE pdf_chunks 
            ADD CONSTRAINT chk_pdf_chunks_embedding_dim 
            CHECK (embedding IS NULL OR array_length(embedding, 1) = 768);
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

-- 5. Ensure migration history is tracked
CREATE TABLE IF NOT EXISTS migration_history (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO migration_history (name) VALUES ('004_job_queue_and_pgvector') ON CONFLICT (name) DO NOTHING;

