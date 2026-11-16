-- ============================================================
-- Migration 003: Cloud Storage Provider & Metadata References
-- ============================================================

ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS storage_provider VARCHAR(30) NOT NULL DEFAULT 'local';
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS storage_path VARCHAR(500) NULL;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100) NULL;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS md5_hash VARCHAR(64) NULL;

CREATE INDEX IF NOT EXISTS idx_pdfs_storage_provider ON pdfs (storage_provider);
CREATE INDEX IF NOT EXISTS idx_pdfs_storage_path ON pdfs (storage_path);

-- Ensure migration history is tracked
CREATE TABLE IF NOT EXISTS migration_history (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO migration_history (name) VALUES ('003_cloud_storage_metadata') ON CONFLICT (name) DO NOTHING;

