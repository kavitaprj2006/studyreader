/**
 * StudyReader — Migration Script: Local Files to Firebase Cloud Storage
 * 
 * Safely migrates all existing uploaded documents to Firebase Cloud Storage.
 * Preserves all document IDs, user ownership, classroom associations, and metadata.
 * Retains existing local files as a fallback rollback safety net.
 */

const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const firebaseStorage = require("../services/storage/firebase-storage");

async function migrate() {
  console.log("=================================================");
  console.log("StudyReader: Migrating Documents to Cloud Storage");
  console.log("=================================================\n");

  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || "studyreader",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD
  });

  const uploadDir = path.resolve(__dirname, "../uploads");

  try {
    const res = await pool.query(
      `SELECT id, user_id, filename, original_filename, file_url, file_size, storage_provider, storage_path, classroom_id, subject_id, category
       FROM pdfs
       ORDER BY id ASC`
    );

    console.log(`Found ${res.rows.length} total documents in database.\n`);

    let migratedCount = 0;
    let alreadyCloudCount = 0;
    let missingFilesCount = 0;
    let totalBytesMigrated = 0;

    for (const doc of res.rows) {
      const localFilePath = path.join(uploadDir, doc.filename);
      const cloudDest = `documents/${doc.user_id}/${doc.id}_${doc.filename}`;

      if (doc.storage_provider === "firebase" && doc.storage_path) {
        const cloudExists = await firebaseStorage.fileExists(doc.storage_path);
        if (cloudExists) {
          console.log(`[ID ${doc.id}] Already in cloud storage (${doc.storage_path}). Skipping.`);
          alreadyCloudCount++;
          continue;
        }
      }

      if (!fs.existsSync(localFilePath)) {
        console.warn(`[ID ${doc.id}] Local file not found on disk at: ${localFilePath}`);
        missingFilesCount++;
        continue;
      }

      console.log(`[ID ${doc.id}] Migrating '${doc.original_filename}' (${doc.filename})...`);
      const uploadResult = await firebaseStorage.uploadFile(localFilePath, cloudDest, {
        originalFilename: doc.original_filename,
        documentId: doc.id,
        userId: doc.user_id,
        classroomId: doc.classroom_id,
        subjectId: doc.subject_id,
        category: doc.category
      });

      // Update database record to point to authenticated file route
      const authenticatedFileUrl = `/api/pdfs/${doc.id}/file`;
      await pool.query(
        `UPDATE pdfs
         SET storage_provider = 'firebase',
             storage_path = $1,
             file_url = $2,
             mime_type = $3,
             md5_hash = $4,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [uploadResult.storagePath, authenticatedFileUrl, uploadResult.mimeType, uploadResult.md5Hash, doc.id]
      );

      migratedCount++;
      totalBytesMigrated += uploadResult.size;
      console.log(`  ✓ Uploaded to cloud: ${uploadResult.storagePath} (${(uploadResult.size / 1024).toFixed(1)} KB, MD5: ${uploadResult.md5Hash})`);
    }

    console.log("\n=================================================");
    console.log("MIGRATION SUMMARY:");
    console.log(`  Total documents in DB:     ${res.rows.length}`);
    console.log(`  Successfully migrated:     ${migratedCount}`);
    console.log(`  Already in cloud:          ${alreadyCloudCount}`);
    console.log(`  Missing local files:       ${missingFilesCount}`);
    console.log(`  Total bytes migrated:      ${(totalBytesMigrated / (1024 * 1024)).toFixed(2)} MB`);
    console.log("=================================================");

  } finally {
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
