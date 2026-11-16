const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST || "localhost",
  port: Number(process.env.DB_PORT) || 5432,
  database: process.env.DB_NAME || "studyreader",
  user: process.env.DB_USER || "postgres",
  password: process.env.DB_PASSWORD,
});

async function check() {
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
  );
  console.log("=== PUBLIC TABLES & ROW COUNTS ===");
  for (const t of tables.rows) {
    const countRes = await pool.query(`SELECT count(*)::int as c FROM "${t.table_name}"`);
    console.log(`  ${t.table_name.padEnd(25)}: ${countRes.rows[0].c} rows`);
  }

  console.log("\n=== INSTALLED EXTENSIONS ===");
  const ext = await pool.query("SELECT extname, extversion FROM pg_extension");
  console.log(ext.rows);

  console.log("\n=== PDFS COLUMNS ===");
  const cols = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pdfs' ORDER BY ordinal_position"
  );
  console.log(cols.rows.map(c => `${c.column_name} (${c.data_type})`).join(", "));

  console.log("\n=== PDF_CHUNKS COLUMNS ===");
  const chunkCols = await pool.query(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'pdf_chunks' ORDER BY ordinal_position"
  );
  console.log(chunkCols.rows.map(c => `${c.column_name} (${c.data_type})`).join(", "));

  await pool.end();
}

check().catch(console.error);
