/**
 * StudyReader — Neon PostgreSQL Database Connection Layer
 * 
 * Manages PostgreSQL connections for both:
 * 1. Pooled Connection (DATABASE_URL via PgBouncer) — for normal application queries, transactions, and session store
 * 2. Direct Connection (DIRECT_URL to Neon compute) — for migrations, DDL, and administrative operations
 * 
 * Features:
 * - Proper SSL enforcement for Neon Cloud
 * - Connection pooling lifecycle and health monitoring
 * - Graceful shutdown on SIGTERM / SIGINT to prevent orphaned connections
 * - Secure credential masking (never exposes connection strings in logs/errors)
 * - Safe fallback to local PostgreSQL when running offline without cloud credentials
 */

const { Pool, Client } = require("pg");
const path = require("path");

// Ensure environment is loaded
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const isProduction = process.env.NODE_ENV === "production";
const hasDatabaseUrl = Boolean(process.env.DATABASE_URL);
const hasDirectUrl = Boolean(process.env.DIRECT_URL);

// Helper to mask connection strings in error logs
function maskConnectionString(connStr) {
  if (!connStr) return "";
  try {
    const url = new URL(connStr);
    return `${url.protocol}//${url.username}:****@${url.host}${url.pathname}`;
  } catch (_) {
    return "[MASKED_DATABASE_URL]";
  }
}

// Determine SSL requirements
const useSsl = Boolean(
  hasDatabaseUrl ||
  hasDirectUrl ||
  process.env.DB_SSL === "true" ||
  (isProduction && !process.env.DB_HOST?.includes("localhost") && !process.env.DB_HOST?.includes("127.0.0.1"))
);

const isServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const defaultPoolMax = isServerless ? 3 : 10;

// 1. Primary Application Pool (Uses DATABASE_URL - Pooled via PgBouncer)
const poolConfig = hasDatabaseUrl
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      max: Number(process.env.DB_POOL_MAX) || defaultPoolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }
  : {
      host: process.env.DB_HOST || "localhost",
      port: Number(process.env.DB_PORT) || 5432,
      database: process.env.DB_NAME || "studyreader",
      user: process.env.DB_USER || "postgres",
      password: process.env.DB_PASSWORD,
      ssl: useSsl ? { rejectUnauthorized: false } : false,
      max: Number(process.env.DB_POOL_MAX) || defaultPoolMax,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    };

const pool = new Pool(poolConfig);

// Pool error logging without exposing credentials
pool.on("error", (err) => {
  console.error("[PostgreSQL Pool] Unexpected idle client error:", err.message);
});

// 2. Direct Connection Client / Pool (Uses DIRECT_URL - Neon Compute Direct)
let directPoolInstance = null;

function getDirectPool() {
  if (directPoolInstance) return directPoolInstance;

  const directConnStr = process.env.DIRECT_URL || process.env.DATABASE_URL;
  if (!directConnStr) {
    return pool; // Fallback to standard pool if no direct URL configured
  }

  directPoolInstance = new Pool({
    connectionString: directConnStr,
    ssl: useSsl ? { rejectUnauthorized: false } : false,
    max: 2, // Low connection limit for DDL/migration operations
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 10000,
  });

  directPoolInstance.on("error", (err) => {
    console.error("[PostgreSQL Direct Pool] Error:", err.message);
  });

  return directPoolInstance;
}

// 3. Graceful shutdown handler
let isShuttingDown = false;

async function closePools() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("[PostgreSQL] Gracefully closing database connection pools...");

  try {
    await pool.end();
    if (directPoolInstance) {
      await directPoolInstance.end();
    }
    console.log("[PostgreSQL] Connection pools closed cleanly.");
  } catch (err) {
    console.warn("[PostgreSQL] Error during pool termination:", err.message);
  }
}

// Register process exit listeners for clean connection lifecycle
if (!process.env.VERCEL) {
  process.on("SIGINT", async () => {
    await closePools();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    await closePools();
    process.exit(0);
  });
}

// 4. Safe Query Wrapper with Error Sanitization
async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    // Redact any credential info that might accidentally be present in error messages
    if (err.message && (err.message.includes("postgres://") || err.message.includes("postgresql://"))) {
      err.message = err.message.replace(/postgres(?:ql)?:\/\/[^\s]+/g, "[REDACTED_DB_URL]");
    }
    throw err;
  }
}

module.exports = {
  pool,
  query,
  getDirectPool,
  closePools,
  maskConnectionString,
  isCloudConnected: Boolean(hasDatabaseUrl),
  providerName: hasDatabaseUrl ? "Neon PostgreSQL" : "Local PostgreSQL"
};
