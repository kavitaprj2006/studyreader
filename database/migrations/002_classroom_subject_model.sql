-- ============================================================
-- Migration 002: Digital Classrooms, Dynamic Subjects & Resource Categorization
-- ============================================================

-- 1. Classrooms
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

-- 2. Classroom Members (Enrolled students)
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

-- 3. Subjects
CREATE TABLE IF NOT EXISTS subjects (
    id BIGSERIAL PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    code VARCHAR(50) NULL,
    description TEXT NULL,
    created_by BIGINT NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 4. Classroom Subjects (Subjects belonging to a teacher's classroom)
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

-- 5. Student Subjects (Personal subjects created directly by students)
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

-- 6. Extend PDFs table for Classroom and Subject Organization
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS classroom_id BIGINT NULL REFERENCES classrooms(id) ON DELETE SET NULL;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS subject_id BIGINT NULL REFERENCES subjects(id) ON DELETE SET NULL;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS category VARCHAR(30) NOT NULL DEFAULT 'resource';
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS academic_year VARCHAR(50) NULL;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS semester VARCHAR(50) NULL;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS is_archived BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE pdfs ADD COLUMN IF NOT EXISTS access_scope VARCHAR(30) NOT NULL DEFAULT 'private';

-- 7. Notifications
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
