-- ============================================================
-- Migration 006: Persistent Classroom Notifications Schema
-- ============================================================

-- 1. Add resource_id column referencing pdfs(id)
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS resource_id BIGINT NULL;

-- Add foreign key constraint if missing
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'notifications_resource_id_fkey'
    ) THEN
        ALTER TABLE notifications
        ADD CONSTRAINT notifications_resource_id_fkey
        FOREIGN KEY (resource_id) REFERENCES pdfs(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 2. Add read_at column for tracking read timestamp
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ NULL;

-- Backfill read_at for already read notifications
UPDATE notifications
SET read_at = created_at
WHERE is_read = TRUE AND read_at IS NULL;

-- 3. Indexes for high-performance notification retrieval and badge counts
CREATE INDEX IF NOT EXISTS idx_notifications_user_lookup
ON notifications (user_id, is_read, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_resource_id
ON notifications (resource_id)
WHERE resource_id IS NOT NULL;

-- 4. Partial unique index to enforce idempotency on resource notifications
CREATE UNIQUE INDEX IF NOT EXISTS uq_notifications_user_resource_type
ON notifications (user_id, resource_id, type)
WHERE resource_id IS NOT NULL;
