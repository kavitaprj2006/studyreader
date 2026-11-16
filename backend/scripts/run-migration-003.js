const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

async function runMigration() {
  const pool = new Pool({
    host: process.env.DB_HOST || "localhost",
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || "studyreader",
    user: process.env.DB_USER || "postgres",
    password: process.env.DB_PASSWORD
  });

  const sqlPath = path.resolve(__dirname, "../../database/migrations/003_cloud_storage_metadata.sql");
  const sql = fs.readFileSync(sqlPath, "utf8");

  await pool.query(sql);
  console.log("Migration 003 applied successfully.");

  const verify = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pdfs' AND column_name IN ('storage_provider', 'storage_path', 'mime_type', 'md5_hash') ORDER BY column_name"
  );
  console.log("Verified new columns:", verify.rows);
  await pool.end();
}

runMigration().catch((err) => {
  console.error("Migration error:", err);
  process.exit(1);
});
