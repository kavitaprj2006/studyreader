const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const STANDARD_SUBJECTS = [
  "Database Management Systems", "Data Structures & Algorithms", "Operating Systems",
  "Computer Networks", "Software Engineering", "Machine Learning & AI",
  "Cloud Computing & DevOps", "Discrete Mathematics", "Mathematics",
  "Physics", "Chemistry", "Biology",
  "English Literature", "History & Civics", "Economics"
];

async function seed() {
  console.log("Checking and seeding standard academic catalog subjects...");
  for (const name of STANDARD_SUBJECTS) {
    const res = await pool.query("SELECT id FROM subjects WHERE name ILIKE $1 LIMIT 1", [name]);
    if (res.rows.length === 0) {
      const ins = await pool.query(
        "INSERT INTO subjects (name, is_active, educational_level) VALUES ($1, TRUE, 'general') RETURNING id",
        [name]
      );
      console.log(`+ Seeded subject: "${name}" (ID: ${ins.rows[0].id})`);
    } else {
      console.log(`= Subject exists: "${name}" (ID: ${res.rows[0].id})`);
    }
  }
  console.log("Standard catalog verification complete.");
  await pool.end();
}

seed().catch(err => {
  console.error("Seed error:", err);
  process.exit(1);
});
