-- ============================================================
-- StudyReader PostgreSQL Database Schema
-- ============================================================

-- The database "studyreader" is created separately in pgAdmin.
-- Do NOT use CREATE DATABASE or USE here.

-- ============================================================
-- USERS
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
    id BIGSERIAL PRIMARY KEY,

    name VARCHAR(100) NOT NULL,

    email VARCHAR(255) NOT NULL,

    password_hash VARCHAR(255) NOT NULL,

    role VARCHAR(20) NOT NULL DEFAULT 'student'
        CHECK (role IN ('student', 'teacher', 'admin')),

    is_active BOOLEAN NOT NULL DEFAULT TRUE,

    is_approved BOOLEAN NOT NULL DEFAULT TRUE,

    firebase_uid VARCHAR(128) NULL,

    email_verified_at TIMESTAMPTZ NULL,

    failed_login_attempts INTEGER NOT NULL DEFAULT 0
        CHECK (failed_login_attempts >= 0),

    locked_until TIMESTAMPTZ NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    last_login TIMESTAMPTZ NULL,

    CONSTRAINT uq_users_email UNIQUE (email)
);

-- Case-insensitive email uniqueness.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
ON users (LOWER(email));

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_firebase_uid
ON users (firebase_uid)
WHERE firebase_uid IS NOT NULL;


-- ============================================================
-- PDFS
-- ============================================================

CREATE TABLE IF NOT EXISTS pdfs (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    filename VARCHAR(255) NOT NULL,

    original_filename VARCHAR(255) NOT NULL,

    file_url VARCHAR(500) NOT NULL,

    file_size BIGINT NOT NULL DEFAULT 0
        CHECK (file_size >= 0),

    page_count INTEGER NULL
        CHECK (page_count IS NULL OR page_count >= 0),

    overview TEXT NULL,

    processing_status VARCHAR(20) NOT NULL DEFAULT 'uploaded'
        CHECK (
            processing_status IN (
                'uploaded',
                'processing',
                'completed',
                'failed'
            )
        ),

    processing_error TEXT NULL,

    classroom_id BIGINT NULL,

    subject_id BIGINT NULL,

    category VARCHAR(30) NOT NULL DEFAULT 'resource'
        CHECK (category IN ('resource', 'pyq')),

    academic_year VARCHAR(50) NULL,

    semester VARCHAR(50) NULL,

    is_archived BOOLEAN NOT NULL DEFAULT FALSE,

    access_scope VARCHAR(30) NOT NULL DEFAULT 'private'
        CHECK (access_scope IN ('private', 'classroom', 'public')),

    storage_provider VARCHAR(50) NOT NULL DEFAULT 'local_private',

    storage_path VARCHAR(500) NULL,

    mime_type VARCHAR(100) NULL,

    md5_hash VARCHAR(64) NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_pdfs_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_pdfs_user_created
ON pdfs (user_id, created_at DESC);


-- ============================================================
-- TOPICS
-- ============================================================

CREATE TABLE IF NOT EXISTS topics (
    id BIGSERIAL PRIMARY KEY,

    pdf_id BIGINT NOT NULL,

    title VARCHAR(255) NOT NULL,

    summary TEXT NULL,

    explanation TEXT NULL,

    order_number INTEGER NOT NULL
        CHECK (order_number >= 0),

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_topics_pdf
        FOREIGN KEY (pdf_id)
        REFERENCES pdfs(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_topics_pdf_order
ON topics (pdf_id, order_number);


-- ============================================================
-- CHAT MESSAGES
-- ============================================================

CREATE TABLE IF NOT EXISTS chat_messages (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NOT NULL,

    pdf_id BIGINT NOT NULL,

    role VARCHAR(20) NOT NULL
        CHECK (role IN ('user', 'assistant')),

    message TEXT NOT NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT fk_chat_user
        FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    CONSTRAINT fk_chat_pdf
        FOREIGN KEY (pdf_id)
        REFERENCES pdfs(id)
        ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chat_pdf_created
ON chat_messages (pdf_id, created_at);

CREATE INDEX IF NOT EXISTS idx_chat_user
ON chat_messages (user_id);


-- ============================================================
-- EXPRESS SESSION STORE
-- Compatible with connect-pg-simple
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
    sid VARCHAR(255) PRIMARY KEY,

    sess JSON NOT NULL,

    expire TIMESTAMP(6) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_expire
ON sessions (expire);


-- ============================================================
-- DOCUMENT JOBS
-- Asynchronous queue for background document processing
-- ============================================================

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


-- ============================================================
-- PDF CHUNKS
-- Prepared for vector search and hybrid RAG
-- ============================================================

CREATE TABLE IF NOT EXISTS pdf_chunks (
    id BIGSERIAL PRIMARY KEY,

    pdf_id BIGINT NOT NULL,

    chunk_index INTEGER NOT NULL
        CHECK (chunk_index >= 0),

    page_start INTEGER NULL
        CHECK (page_start IS NULL OR page_start >= 1),

    page_end INTEGER NULL
        CHECK (page_end IS NULL OR page_end >= 1),

    content TEXT NOT NULL,

    metadata JSONB NULL DEFAULT '{}'::jsonb,

    embedding double precision[] NULL,

    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT uq_pdf_chunk
        UNIQUE (pdf_id, chunk_index),

    CONSTRAINT fk_chunks_pdf
        FOREIGN KEY (pdf_id)
        REFERENCES pdfs(id)
        ON DELETE CASCADE,

    CONSTRAINT chk_pdf_chunks_embedding_dim
        CHECK (embedding IS NULL OR array_length(embedding, 1) = 768)
);

CREATE INDEX IF NOT EXISTS idx_chunks_pdf
ON pdf_chunks (pdf_id);


-- ============================================================
-- ANALYTICS EVENTS
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics_events (
    id BIGSERIAL PRIMARY KEY,

    user_id BIGINT NULL,

    event_name VARCHAR(100) NOT NULL,

    entity_type VARCHAR(50) NULL,

    entity_id BIGINT NULL,

    metadata JSONB NULL,

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


-- ============================================================
-- CLASSROOMS & SUBJECTS
-- ============================================================

CREATE TABLE IF NOT EXISTS classrooms (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(20) NOT NULL,
    teacher_id BIGINT NOT NULL,
    semester VARCHAR(50) NULL,
    section VARCHAR(50) NULL,
    description TEXT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_classrooms_teacher
        FOREIGN KEY (teacher_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT uq_classrooms_code UNIQUE (code)
);

CREATE INDEX IF NOT EXISTS idx_classrooms_teacher
ON classrooms (teacher_id, created_at DESC);

CREATE TABLE IF NOT EXISTS classroom_members (
    id BIGSERIAL PRIMARY KEY,
    classroom_id BIGINT NOT NULL,
    student_id BIGINT NOT NULL,
    joined_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_members_classroom
        FOREIGN KEY (classroom_id)
        REFERENCES classrooms(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_members_student
        FOREIGN KEY (student_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT uq_classroom_member
        UNIQUE (classroom_id, student_id)
);

CREATE INDEX IF NOT EXISTS idx_members_student
ON classroom_members (student_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS subjects (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NULL,
    description TEXT NULL,
    created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS classroom_subjects (
    id BIGSERIAL PRIMARY KEY,
    classroom_id BIGINT NOT NULL,
    subject_id BIGINT NOT NULL,
    teacher_id BIGINT NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_cs_classroom
        FOREIGN KEY (classroom_id)
        REFERENCES classrooms(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_cs_subject
        FOREIGN KEY (subject_id)
        REFERENCES subjects(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_cs_teacher
        FOREIGN KEY (teacher_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT uq_classroom_subject
        UNIQUE (classroom_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_cs_classroom
ON classroom_subjects (classroom_id);

CREATE TABLE IF NOT EXISTS student_subjects (
    id BIGSERIAL PRIMARY KEY,
    student_id BIGINT NOT NULL,
    subject_id BIGINT NOT NULL,
    is_archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_ss_student
        FOREIGN KEY (student_id)
        REFERENCES users(id)
        ON DELETE CASCADE,
    CONSTRAINT fk_ss_subject
        FOREIGN KEY (subject_id)
        REFERENCES subjects(id)
        ON DELETE CASCADE,
    CONSTRAINT uq_student_subject
        UNIQUE (student_id, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_ss_student
ON student_subjects (student_id);

CREATE TABLE IF NOT EXISTS notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    classroom_id BIGINT NULL REFERENCES classrooms(id) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    type VARCHAR(50) NOT NULL DEFAULT 'announcement',
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
ON notifications (user_id, created_at DESC);

-- ============================================================
-- TRIGGER FOR updated_at
-- PostgreSQL does not support MySQL's
-- ON UPDATE CURRENT_TIMESTAMP.
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;


DROP TRIGGER IF EXISTS trg_users_updated_at ON users;

CREATE TRIGGER trg_users_updated_at
BEFORE UPDATE ON users
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


DROP TRIGGER IF EXISTS trg_pdfs_updated_at ON pdfs;

CREATE TRIGGER trg_pdfs_updated_at
BEFORE UPDATE ON pdfs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS trg_document_jobs_updated_at ON document_jobs;

CREATE TRIGGER trg_document_jobs_updated_at
BEFORE UPDATE ON document_jobs
FOR EACH ROW
EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- MIGRATION HISTORY
-- Tracks applied migrations idempotently
-- ============================================================

CREATE TABLE IF NOT EXISTS migration_history (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
