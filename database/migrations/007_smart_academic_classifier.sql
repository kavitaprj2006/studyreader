-- ============================================================
-- Migration 007: Dynamic Academic Subject Classifier Schema
-- ============================================================

-- 1. Non-destructively enhance subjects table with academic context metadata
ALTER TABLE subjects
ADD COLUMN IF NOT EXISTS educational_level VARCHAR(50) DEFAULT 'general',
ADD COLUMN IF NOT EXISTS course_or_grade VARCHAR(100) NULL,
ADD COLUMN IF NOT EXISTS semester VARCHAR(50) NULL,
ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- 2. Non-destructively enhance pdfs table with ML classification metadata
ALTER TABLE pdfs
ADD COLUMN IF NOT EXISTS predicted_subject_id BIGINT NULL REFERENCES subjects(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS prediction_confidence NUMERIC(5, 4) NULL,
ADD COLUMN IF NOT EXISTS classification_status VARCHAR(50) NOT NULL DEFAULT 'unclassified',
ADD COLUMN IF NOT EXISTS classification_model_version VARCHAR(50) NULL,
ADD COLUMN IF NOT EXISTS classified_at TIMESTAMPTZ NULL,
ADD COLUMN IF NOT EXISTS classification_source VARCHAR(50) DEFAULT 'unclassified',
ADD COLUMN IF NOT EXISTS manually_selected_subject_id BIGINT NULL REFERENCES subjects(id) ON DELETE SET NULL;

-- 3. High-performance lookup indexes for classification status and subject queries
CREATE INDEX IF NOT EXISTS idx_pdfs_classification_status
ON pdfs (classification_status);

CREATE INDEX IF NOT EXISTS idx_pdfs_predicted_subject
ON pdfs (predicted_subject_id)
WHERE predicted_subject_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_subjects_active_lookup
ON subjects (is_active, educational_level);
