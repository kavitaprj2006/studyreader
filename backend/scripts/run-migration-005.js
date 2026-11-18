const { pool } = require('../db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    const sqlPath = path.join(__dirname, '..', '..', 'database', 'migrations', '005_persistent_ai_cache.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Applying migration 005 (Persistent AI Cache) to Neon PostgreSQL...');
    await pool.query(sql);
    console.log('\x1b[32m✔ Migration 005 applied successfully!\x1b[0m');

    // Verify ai_summary_cache
    const summaryRes = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'ai_summary_cache'
      ORDER BY ordinal_position
    `);
    console.log('\nai_summary_cache columns in Neon:');
    summaryRes.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type})`));

    // Verify ai_answer_cache
    const answerRes = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'ai_answer_cache'
      ORDER BY ordinal_position
    `);
    console.log('\nai_answer_cache columns in Neon:');
    answerRes.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type})`));

    // Verify ai_cache_stats
    const statsRes = await pool.query('SELECT metric_name, metric_value FROM ai_cache_stats');
    console.log('\nai_cache_stats initial records:');
    statsRes.rows.forEach(r => console.log(`  - ${r.metric_name}: ${r.metric_value}`));

  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
