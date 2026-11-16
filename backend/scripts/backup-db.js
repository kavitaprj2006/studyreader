const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const backupsDir = path.join(__dirname, '..', '..', 'database', 'backups');
if (!fs.existsSync(backupsDir)) {
  fs.mkdirSync(backupsDir, { recursive: true });
}

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const outFile = path.join(backupsDir, `studyreader_backup_${timestamp}.sql`);
const latestFile = path.join(backupsDir, 'studyreader_pre_cloud_backup.sql');

const pgDumpCandidates = [
  'C:\\Program Files\\PostgreSQL\\18\\bin\\pg_dump.exe',
  'C:\\Program Files\\PostgreSQL\\17\\bin\\pg_dump.exe',
  'C:\\Program Files\\PostgreSQL\\16\\bin\\pg_dump.exe',
  'pg_dump'
];

let pgDump = 'pg_dump';
for (const cand of pgDumpCandidates) {
  if (cand === 'pg_dump' || fs.existsSync(cand)) {
    pgDump = cand;
    break;
  }
}

console.log(`Using pg_dump binary: ${pgDump}`);
console.log(`Backing up database: ${process.env.DB_NAME} on ${process.env.DB_HOST}:${process.env.DB_PORT}`);

const env = {
  ...process.env,
  PGPASSWORD: process.env.DB_PASSWORD || ''
};

try {
  const cmd = `"${pgDump}" -h ${process.env.DB_HOST || 'localhost'} -p ${process.env.DB_PORT || 5432} -U ${process.env.DB_USER || 'postgres'} -d ${process.env.DB_NAME || 'studyreader'} -f "${outFile}"`;
  execSync(cmd, { env, stdio: 'inherit' });
  fs.copyFileSync(outFile, latestFile);
  const stats = fs.statSync(outFile);
  console.log(`\x1b[32m✔ SUCCESS: Backup created successfully at:\x1b[0m\n  ${outFile}\n  ${latestFile}\n  Size: ${(stats.size / 1024).toFixed(2)} KB`);
} catch (err) {
  console.error('\x1b[31m✖ Backup failed:\x1b[0m', err.message);
  process.exit(1);
}
