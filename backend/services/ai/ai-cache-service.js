/**
 * StudyReader — Persistent AI Cache Service
 *
 * Manages persistent caching of document summaries and document-grounded answers
 * in Neon PostgreSQL. Survives serverless cold starts and prevents redundant AI API calls.
 *
 * Non-blocking guarantee: Database errors never throw or disrupt live AI generation.
 */

const crypto = require("crypto");
const { pool } = require("../../db");

const CURRENT_PROMPT_VERSION = "v1";

/**
 * Computes SHA-256 hash of a string.
 */
function hashString(str) {
  return crypto.createHash("sha256").update(String(str || "")).digest("hex");
}

/**
 * Normalizes question for conservative cache matching.
 * Converts to lowercase, strips trailing punctuation, collapses whitespace.
 */
function normalizeQuestion(question) {
  return String(question || "")
    .toLowerCase()
    .trim()
    .replace(/[?!.,;:]+$/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Retrieves a cached summary if valid.
 */
async function getCachedSummary({
  documentId,
  summaryType = "quick",
  contentHash = "default",
  promptVersion = CURRENT_PROMPT_VERSION
}) {
  if (!documentId) return null;

  try {
    const query = `
      SELECT id, summary_text, sources, model, provider, hit_count, created_at
      FROM ai_summary_cache
      WHERE document_id = $1
        AND summary_type = $2
        AND content_hash = $3
        AND prompt_version = $4
      LIMIT 1
    `;
    const res = await pool.query(query, [
      documentId,
      summaryType,
      contentHash,
      promptVersion
    ]);

    if (res.rows.length === 0) {
      // Record miss asynchronously
      pool.query(`UPDATE ai_cache_stats SET metric_value = metric_value + 1 WHERE metric_name = 'summary_misses'`).catch(() => {});
      return null;
    }

    const row = res.rows[0];

    // Increment hit counter asynchronously
    pool.query(`
      UPDATE ai_summary_cache SET hit_count = hit_count + 1, updated_at = NOW() WHERE id = $1;
      UPDATE ai_cache_stats SET metric_value = metric_value + 1 WHERE metric_name = 'summary_hits';
    `, [row.id]).catch(() => {});

    return {
      text: row.summary_text,
      sources: row.sources || [],
      model: row.model,
      provider: row.provider,
      cached: true,
      hitCount: row.hit_count + 1,
      createdAt: row.created_at
    };

  } catch (err) {
    console.warn(`[AICacheService] Summary cache lookup error for doc ${documentId}:`, err.message);
    return null;
  }
}

/**
 * Saves a completed summary into persistent cache.
 */
async function setCachedSummary({
  documentId,
  summaryType = "quick",
  contentHash = "default",
  promptVersion = CURRENT_PROMPT_VERSION,
  summaryText,
  sources = [],
  model = "gemini",
  provider = "gemini"
}) {
  if (!documentId || !summaryText || summaryText.length < 20) return false;

  try {
    const query = `
      INSERT INTO ai_summary_cache (
        document_id, summary_type, content_hash, prompt_version,
        model, provider, summary_text, sources
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      ON CONFLICT (document_id, summary_type, content_hash, prompt_version)
      DO UPDATE SET
        summary_text = EXCLUDED.summary_text,
        sources = EXCLUDED.sources,
        model = EXCLUDED.model,
        provider = EXCLUDED.provider,
        updated_at = NOW()
    `;
    await pool.query(query, [
      documentId,
      summaryType,
      contentHash,
      promptVersion,
      model,
      provider,
      summaryText,
      JSON.stringify(sources)
    ]);
    return true;
  } catch (err) {
    console.warn(`[AICacheService] Summary cache store error for doc ${documentId}:`, err.message);
    return false;
  }
}

/**
 * Retrieves a cached grounded answer if valid and unexpired.
 */
async function getCachedAnswer({
  documentId,
  question,
  contextFingerprint = "default",
  contentHash = "default",
  promptVersion = CURRENT_PROMPT_VERSION
}) {
  if (!documentId || !question) return null;

  const normalized = normalizeQuestion(question);
  const qHash = hashString(normalized);

  try {
    const query = `
      SELECT id, answer_text, sources, model, provider, hit_count, created_at
      FROM ai_answer_cache
      WHERE document_id = $1
        AND question_hash = $2
        AND context_fingerprint = $3
        AND content_hash = $4
        AND prompt_version = $5
        AND expires_at > NOW()
      LIMIT 1
    `;
    const res = await pool.query(query, [
      documentId,
      qHash,
      contextFingerprint,
      contentHash,
      promptVersion
    ]);

    if (res.rows.length === 0) {
      pool.query(`UPDATE ai_cache_stats SET metric_value = metric_value + 1 WHERE metric_name = 'answer_misses'`).catch(() => {});
      return null;
    }

    const row = res.rows[0];

    // Increment hit counter asynchronously
    pool.query(`
      UPDATE ai_answer_cache SET hit_count = hit_count + 1 WHERE id = $1;
      UPDATE ai_cache_stats SET metric_value = metric_value + 1 WHERE metric_name = 'answer_hits';
    `, [row.id]).catch(() => {});

    return {
      text: row.answer_text,
      sources: row.sources || [],
      model: row.model,
      provider: row.provider,
      cached: true,
      hitCount: row.hit_count + 1,
      createdAt: row.created_at
    };

  } catch (err) {
    console.warn(`[AICacheService] Answer cache lookup error for doc ${documentId}:`, err.message);
    return null;
  }
}

/**
 * Saves a completed grounded answer into persistent cache.
 */
async function setCachedAnswer({
  documentId,
  question,
  contextFingerprint = "default",
  contentHash = "default",
  promptVersion = CURRENT_PROMPT_VERSION,
  answerText,
  sources = [],
  model = "gemini",
  provider = "gemini"
}) {
  if (!documentId || !question || !answerText || answerText.length < 15) return false;

  const normalized = normalizeQuestion(question);
  const qHash = hashString(normalized);

  try {
    const query = `
      INSERT INTO ai_answer_cache (
        document_id, question_hash, normalized_question,
        context_fingerprint, content_hash, prompt_version,
        model, provider, answer_text, sources
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (document_id, question_hash, context_fingerprint, content_hash, prompt_version)
      DO UPDATE SET
        answer_text = EXCLUDED.answer_text,
        sources = EXCLUDED.sources,
        model = EXCLUDED.model,
        provider = EXCLUDED.provider
    `;
    await pool.query(query, [
      documentId,
      qHash,
      normalized,
      contextFingerprint,
      contentHash,
      promptVersion,
      model,
      provider,
      answerText,
      JSON.stringify(sources)
    ]);
    return true;
  } catch (err) {
    console.warn(`[AICacheService] Answer cache store error for doc ${documentId}:`, err.message);
    return false;
  }
}

/**
 * Invalidates all cached summaries and answers for a modified document.
 */
async function invalidateDocumentCache(documentId) {
  if (!documentId) return false;
  try {
    await Promise.all([
      pool.query("DELETE FROM ai_summary_cache WHERE document_id = $1", [documentId]),
      pool.query("DELETE FROM ai_answer_cache WHERE document_id = $1", [documentId])
    ]);
    console.log(`[AICacheService] Successfully invalidated cache for document ${documentId}`);
    return true;
  } catch (err) {
    console.warn(`[AICacheService] Invalidation error for doc ${documentId}:`, err.message);
    return false;
  }
}

/**
 * Retrieves aggregate cache metrics for admin dashboard.
 */
async function getCacheMetrics() {
  try {
    const [statsRes, summaryCountRes, answerCountRes] = await Promise.all([
      pool.query("SELECT metric_name, metric_value FROM ai_cache_stats"),
      pool.query("SELECT COUNT(*)::int as count, COALESCE(SUM(hit_count), 0)::int as total_hits FROM ai_summary_cache"),
      pool.query("SELECT COUNT(*)::int as count, COALESCE(SUM(hit_count), 0)::int as total_hits FROM ai_answer_cache")
    ]);

    const statsMap = {};
    statsRes.rows.forEach(r => {
      statsMap[r.metric_name] = parseInt(r.metric_value, 10);
    });

    const summaryHits = statsMap.summary_hits || summaryCountRes.rows[0].total_hits || 0;
    const summaryMisses = statsMap.summary_misses || 0;
    const answerHits = statsMap.answer_hits || answerCountRes.rows[0].total_hits || 0;
    const answerMisses = statsMap.answer_misses || 0;

    const totalHits = summaryHits + answerHits;
    const totalRequests = totalHits + summaryMisses + answerMisses;
    const hitRate = totalRequests > 0 ? ((totalHits / totalRequests) * 100).toFixed(1) : "0.0";

    return {
      summaryCacheEntries: summaryCountRes.rows[0].count,
      summaryHits,
      summaryMisses,
      answerCacheEntries: answerCountRes.rows[0].count,
      answerHits,
      answerMisses,
      totalHits,
      totalMisses: summaryMisses + answerMisses,
      hitRate: `${hitRate}%`,
      estimatedSavedAiCalls: totalHits
    };
  } catch (err) {
    console.warn("[AICacheService] Error retrieving cache metrics:", err.message);
    return {
      summaryCacheEntries: 0,
      summaryHits: 0,
      summaryMisses: 0,
      answerCacheEntries: 0,
      answerHits: 0,
      answerMisses: 0,
      totalHits: 0,
      totalMisses: 0,
      hitRate: "0.0%",
      estimatedSavedAiCalls: 0
    };
  }
}

module.exports = {
  hashString,
  normalizeQuestion,
  getCachedSummary,
  setCachedSummary,
  getCachedAnswer,
  setCachedAnswer,
  invalidateDocumentCache,
  getCacheMetrics
};
