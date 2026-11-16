-- ============================================================
-- Migration 001: Add Teacher Role & Account Status
-- ============================================================

-- 1. Drop existing role check constraint on users table
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;

-- 2. Add updated check constraint allowing 'student', 'teacher', and 'admin'
ALTER TABLE users ADD CONSTRAINT users_role_check
    CHECK (role IN ('student', 'teacher', 'admin'));

-- 3. Add is_approved flag for role validation / teacher approval workflows
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE;

-- 4. Add firebase_uid for future Firebase Auth ID token mapping
ALTER TABLE users ADD COLUMN IF NOT EXISTS firebase_uid VARCHAR(128) NULL;

-- 5. Add unique index on firebase_uid
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
    ON users (firebase_uid)
    WHERE firebase_uid IS NOT NULL;
