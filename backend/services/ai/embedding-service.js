/**
 * StudyReader — Gemini Vector Embedding Service
 * 
 * Provides vector embeddings via hosted Google Gemini API:
 * - Model: models/gemini-embedding-001 with outputDimensionality: 768 (matching pgvector vector(768))
 * - High-speed batch processing with concurrency control
 * - Cosine similarity calculation for pure-JS fallback
 * - SQL vector formatting for Neon/pgvector
 */

const path = require("path");

function getApiKey() {
  return (process.env.GEMINI_API_KEY || "").trim();
}

/**
 * Calculates cosine similarity between two numeric vectors.
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Generates a 768-dimension embedding for a single text chunk.
 */
async function generateEmbedding(text, retryCount = 0) {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const cleanText = String(text || "").trim();
  if (!cleanText) {
    return new Array(768).fill(0);
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent?key=${apiKey}`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "models/gemini-embedding-001",
        content: { parts: [{ text: cleanText.slice(0, 8000) }] },
        outputDimensionality: 768
      })
    });

    if (!response.ok) {
      if (response.status === 429 && retryCount < 3) {
        await new Promise((resolve) => setTimeout(resolve, 2000 * (retryCount + 1)));
        return generateEmbedding(text, retryCount + 1);
      }
      const errBody = await response.text();
      throw new Error(`Gemini embedContent failed (${response.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await response.json();
    const values = data.embedding?.values;
    if (!Array.isArray(values) || values.length === 0) {
      throw new Error("No embedding values returned from Gemini.");
    }

    return values;
  } catch (err) {
    if (retryCount < 2) {
      await new Promise((resolve) => setTimeout(resolve, 1500 * (retryCount + 1)));
      return generateEmbedding(text, retryCount + 1);
    }
    throw err;
  }
}

/**
 * Generates embeddings for an array of text chunks with bounded concurrency.
 */
async function batchGenerateEmbeddings(chunks, batchSize = 4) {
  const results = [];
  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const batchPromises = batch.map((item) => {
      const textToEmbed = typeof item === "string" ? item : (item.text || item.content || "");
      return generateEmbedding(textToEmbed).catch((err) => {
        console.warn(`[EmbeddingService] Chunk embedding error: ${err.message}. Using zero vector.`);
        return new Array(768).fill(0);
      });
    });
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
  }
  return results;
}

/**
 * Formats vector array as Postgres vector literal "[0.1, 0.2, ...]" or ARRAY[...].
 */
function formatVectorLiteral(vec) {
  if (!Array.isArray(vec)) return null;
  return `[${vec.join(",")}]`;
}

module.exports = {
  generateEmbedding,
  batchGenerateEmbeddings,
  cosineSimilarity,
  formatVectorLiteral
};
