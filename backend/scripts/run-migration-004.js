const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function runMigration() {
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('Connecting to database:', process.env.DB_NAME);
    const sqlPath = path.join(__dirname, '..', '..', 'database', 'migrations', '004_job_queue_and_pgvector.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Applying migration 004...');
    await pool.query(sql);
    console.log('\x1b[32m✔ Migration 004 applied successfully!\x1b[0m');

    // Verify document_jobs
    const jobsRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'document_jobs'
      ORDER BY ordinal_position
    `);
    console.log('\ndocument_jobs columns:');
    jobsRes.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type})`));

    // Verify pdf_chunks columns
    const chunksRes = await pool.query(`
      SELECT column_name, data_type, udt_name 
      FROM information_schema.columns 
      WHERE table_name = 'pdf_chunks'
      ORDER BY ordinal_position
    `);
    console.log('\npdf_chunks columns:');
    chunksRes.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type} / ${r.udt_name})`));

    // Verify analytics_events
    const analyticsRes = await pool.query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'analytics_events'
      ORDER BY ordinal_position
    `);
    console.log('\nanalytics_events columns:');
    analyticsRes.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type})`));

  } catch (err) {
    console.error('\x1b[31m✖ Migration 004 failed:\x1b[0m', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
