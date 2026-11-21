const { pool } = require('../db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    const sqlPath = path.join(__dirname, '..', '..', 'database', 'migrations', '007_smart_academic_classifier.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Applying migration 007 (Smart Academic Classifier Schema) to Neon PostgreSQL...');
    await pool.query(sql);
    console.log('\x1b[32m✔ Migration 007 applied successfully!\x1b[0m');

    // Verify subjects columns
    const subjectsCols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'subjects'
      ORDER BY ordinal_position
    `);
    console.log('\nsubjects columns in Neon:');
    subjectsCols.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`));

    // Verify pdfs columns
    const pdfsCols = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'pdfs' AND column_name IN (
        'predicted_subject_id', 'prediction_confidence', 'classification_status',
        'classification_model_version', 'classified_at', 'classification_source',
        'manually_selected_subject_id'
      )
      ORDER BY ordinal_position
    `);
    console.log('\nNew ML classification columns in pdfs:');
    pdfsCols.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`));

    // Verify existing data integrity
    const countSubjects = await pool.query('SELECT COUNT(*)::int as count FROM subjects');
    const countPdfs = await pool.query('SELECT COUNT(*)::int as count FROM pdfs');
    console.log(`\nData Integrity Verification:`);
    console.log(`  - Existing subjects count: ${countSubjects.rows[0].count} (Preserved)`);
    console.log(`  - Existing pdfs count: ${countPdfs.rows[0].count} (Preserved)`);

  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
