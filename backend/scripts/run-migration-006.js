const { pool } = require('../db');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  try {
    const sqlPath = path.join(__dirname, '..', '..', 'database', 'migrations', '006_classroom_notifications.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    console.log('Applying migration 006 (Classroom Notifications) to Neon PostgreSQL...');
    await pool.query(sql);
    console.log('\x1b[32m✔ Migration 006 applied successfully!\x1b[0m');

    // Verify notifications columns
    const notifRes = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'notifications'
      ORDER BY ordinal_position
    `);
    console.log('\nnotifications columns in Neon:');
    notifRes.rows.forEach(r => console.log(`  - ${r.column_name} (${r.data_type}, nullable: ${r.is_nullable})`));

    // Verify indexes
    const indexRes = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'notifications'
      ORDER BY indexname
    `);
    console.log('\nnotifications indexes:');
    indexRes.rows.forEach(r => console.log(`  - ${r.indexname}`));

  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
