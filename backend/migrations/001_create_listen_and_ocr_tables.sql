-- ============================================================
-- StudyReader Listen & OCR System — Non-Destructive Migration
-- ============================================================

-- 1. Listening History & Progress
CREATE TABLE IF NOT EXISTS listening_history (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pdf_id BIGINT NOT NULL REFERENCES pdfs(id) ON DELETE CASCADE,
    last_page INTEGER NOT NULL DEFAULT 1,
    last_block_id VARCHAR(100),
    last_audio_timestamp NUMERIC(10, 2) DEFAULT 0,
    completion_percentage NUMERIC(5, 2) DEFAULT 0,
    total_listened_seconds INTEGER DEFAULT 0,
    voice_used VARCHAR(100),
    speed_used NUMERIC(3, 2) DEFAULT 1.0,
    last_listened_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_user_pdf_listening UNIQUE (user_id, pdf_id)
);

-- Index for fast lookup by user and document
CREATE INDEX IF NOT EXISTS idx_listening_history_user_pdf ON listening_history(user_id, pdf_id);

-- 2. Listening Bookmarks & Notes
CREATE TABLE IF NOT EXISTS listening_bookmarks (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pdf_id BIGINT NOT NULL REFERENCES pdfs(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    block_id VARCHAR(100),
    audio_timestamp NUMERIC(10, 2) DEFAULT 0,
    title VARCHAR(255) NOT NULL,
    note TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_listening_bookmarks_user_pdf ON listening_bookmarks(user_id, pdf_id);

-- 3. Audio Chunk Cache
CREATE TABLE IF NOT EXISTS audio_chunks_cache (
    id BIGSERIAL PRIMARY KEY,
    pdf_id BIGINT REFERENCES pdfs(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    chunk_index INTEGER NOT NULL,
    chunk_hash VARCHAR(64) NOT NULL,
    voice_id VARCHAR(100) NOT NULL,
    speed NUMERIC(3, 2) NOT NULL DEFAULT 1.0,
    storage_path VARCHAR(500) NOT NULL,
    duration_seconds NUMERIC(8, 2),
    file_size_bytes BIGINT,
    mime_type VARCHAR(100) DEFAULT 'audio/mpeg',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_chunk_audio_cache UNIQUE (chunk_hash, voice_id, speed)
);

CREATE INDEX IF NOT EXISTS idx_audio_chunks_cache_pdf ON audio_chunks_cache(pdf_id, page_number);
CREATE INDEX IF NOT EXISTS idx_audio_chunks_cache_hash ON audio_chunks_cache(chunk_hash);

-- 4. Scanned Page OCR Metadata & Quality Tracking
CREATE TABLE IF NOT EXISTS ocr_page_metadata (
    id BIGSERIAL PRIMARY KEY,
    pdf_id BIGINT NOT NULL REFERENCES pdfs(id) ON DELETE CASCADE,
    page_number INTEGER NOT NULL,
    is_scanned BOOLEAN DEFAULT FALSE,
    ocr_applied BOOLEAN DEFAULT FALSE,
    confidence_score NUMERIC(5, 2),
    language VARCHAR(20) DEFAULT 'eng',
    character_count INTEGER DEFAULT 0,
    processing_time_ms INTEGER DEFAULT 0,
    corrected_text TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_pdf_page_ocr UNIQUE (pdf_id, page_number)
);

CREATE INDEX IF NOT EXISTS idx_ocr_page_pdf ON ocr_page_metadata(pdf_id);

-- 5. User Pronunciation Dictionary Overrides
CREATE TABLE IF NOT EXISTS user_pronunciations (
    id BIGSERIAL PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    term VARCHAR(150) NOT NULL,
    phonetic_spoken VARCHAR(255) NOT NULL,
    category VARCHAR(50) DEFAULT 'general',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    CONSTRAINT uq_user_term_pronounce UNIQUE (user_id, term)
);

CREATE INDEX IF NOT EXISTS idx_user_pronunciations_user ON user_pronunciations(user_id);
