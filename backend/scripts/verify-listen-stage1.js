/**
 * StudyReader Listen — Stage 1 Verification Suite
 */

const assert = require("assert");
const path = require("path");
const dotenv = require("../node_modules/dotenv");
dotenv.config({ path: path.join(__dirname, "../.env") });

const { Pool } = require("pg");
const textNormalizer = require("../services/audio/text-normalizer");
const TTSService = require("../services/audio/tts-service");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function runStage1Tests() {
  console.log("\n============================================================");
  console.log("  STUDYREADER LISTEN — STAGE 1 VERIFICATION SUITE");
  console.log("============================================================\n");

  let passed = 0;

  // 1. Database Tables Check
  console.log("📌 CHECK 1: Database Migration Schema");
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('listening_history', 'listening_bookmarks', 'audio_chunks_cache', 'ocr_page_metadata', 'user_pronunciations');"
  );
  assert.strictEqual(tables.rows.length, 5, "All 5 listening and OCR tables must exist in PostgreSQL");
  console.log("  ✔ All 5 Listen & OCR tables verified in database:", tables.rows.map(r => r.table_name).join(", "));
  passed++;

  // 2. Text Normalization: Artifacts, Broken Words, Headers
  console.log("\n📌 CHECK 2: Artifacts & Document Cleanup");
  const rawSample = "Page 1 of 5\n\n■ Section 1: Intro-\nduction with [1, 2] citations, e.g., 25% growth w/o latency.";
  const cleaned = textNormalizer.normalizeText(rawSample);
  assert(!cleaned.includes("Page 1 of 5"), "Should strip page number footer");
  assert(!cleaned.includes("■"), "Should strip geometric symbols/bullets");
  assert(cleaned.includes("Introduction"), "Should join hyphenated line-broken words");
  assert(!cleaned.includes("[1, 2]"), "Should strip citations");
  assert(cleaned.includes("for example"), "Should expand e.g.");
  assert(cleaned.includes("25 percent"), "Should expand 25%");
  assert(cleaned.includes("without"), "Should expand w/o");
  console.log("  ✔ Document cleanup removes artifacts while preserving meaning");
  passed++;

  // 3. Text Normalization: Formulas, Chemicals, Tech Vocabulary
  console.log("\n📌 CHECK 3: Technical & Scientific Normalization");
  const formulaSample = "Water H2O and CO2 reaction. P(A|B) = P(A cap B) / P(B). CPU runs at 3.5 GHz with 16 GB RAM using SaaS and SQL.";
  const normalizedFormula = textNormalizer.normalizeText(formulaSample);
  assert(normalizedFormula.includes("H two O"), "Should expand H2O");
  assert(normalizedFormula.includes("C O two"), "Should expand CO2");
  assert(normalizedFormula.includes("probability of A given B"), "Should normalize P(A|B)");
  assert(normalizedFormula.includes("divided by"), "Should normalize division operator");
  assert(normalizedFormula.includes("C-P-U"), "Should pronounce CPU phonetically");
  assert(normalizedFormula.includes("3 point 5 gigahertz"), "Should expand GHz with decimals");
  assert(normalizedFormula.includes("16 gigabytes"), "Should expand GB units");
  assert(normalizedFormula.includes("sass"), "Should pronounce SaaS phonetically");
  assert(normalizedFormula.includes("sequel"), "Should pronounce SQL phonetically");
  console.log("  ✔ Technical and scientific expressions normalize accurately");
  passed++;

  // 4. Structured Reading Blocks with Sentence-Level Offsets
  console.log("\n📌 CHECK 4: Structured Reading Blocks & Offsets");
  const testSections = [
    {
      pageNumber: 1,
      text: "Chapter 1: Operating Systems\n\nA kernel manages hardware resources. It schedules processes and allocates memory."
    }
  ];
  const blocks = textNormalizer.createReadingBlocks(testSections, "doc_test_1");
  assert.strictEqual(blocks.length, 2, "Should create 2 reading blocks (heading and paragraph)");
  assert.strictEqual(blocks[0].type, "heading", "First block should be classified as heading");
  assert.strictEqual(blocks[1].type, "paragraph", "Second block should be classified as paragraph");
  assert(blocks[1].sentences.length >= 2, "Paragraph block should contain tokenized sentences");
  assert(blocks[1].sentences[0].raw.length > 0, "Sentence should have raw text for DOM highlighting");
  assert(typeof blocks[1].sentences[0].start === "number", "Sentence should have start offset");
  assert(blocks[1].ssmlText.includes("<break"), "Block should include pause SSML");
  console.log("  ✔ Structured reading blocks preserve page mapping, raw text, and sentence offsets");
  passed++;

  // 5. TTS Service Voice Discovery & Synthesis
  console.log("\n📌 CHECK 5: Neural TTS Discovery & Live Synthesis");
  const tts = new TTSService(pool, null);
  const voices = await tts.getAvailableVoices();
  assert(voices.length >= 5, "Should return available neural and browser voices");
  const hasCloudflareLuna = voices.some(v => v.id === "cf:luna");
  assert(hasCloudflareLuna, "Should list Cloudflare Deepgram Luna voice");
  console.log(`  ✔ Found ${voices.length} voices including studio neural models`);

  console.log("  Synthesizing test phrase with Cloudflare Deepgram Aura-2...");
  const synthRes = await tts.synthesizeChunk({
    pdfId: null,
    pageNumber: 1,
    chunkIndex: 0,
    text: "StudyReader Listen verified.",
    voice: "cf:luna",
    speed: 1.0
  });

  assert(synthRes.audioBuffer && synthRes.audioBuffer.length > 1000, "Should generate valid audio buffer > 1KB");
  assert.strictEqual(synthRes.contentType, "audio/mpeg", "Content type must be audio/mpeg");
  console.log(`  ✔ Real neural audio synthesized: ${synthRes.audioBuffer.length} bytes MP3 (latency: ${synthRes.latencyMs}ms)`);
  passed++;

  // 6. Audio Cache Verification
  console.log("\n📌 CHECK 6: Audio Chunk Cache Lookup");
  // Give background cache write 500ms to persist
  await new Promise(r => setTimeout(r, 500));
  const cacheRow = await pool.query(
    "SELECT id, chunk_hash, voice_id, mime_type, file_size_bytes FROM audio_chunks_cache WHERE chunk_hash = $1",
    [synthRes.chunkHash]
  );
  assert(cacheRow.rows.length > 0, "Audio chunk must be saved in audio_chunks_cache table");
  console.log("  ✔ Audio chunk metadata successfully persisted in audio_chunks_cache");
  passed++;

  // Clean test cache row
  await pool.query("DELETE FROM audio_chunks_cache WHERE chunk_hash = $1", [synthRes.chunkHash]);

  console.log("\n============================================================");
  console.log(`  RESULTS: ${passed} / 6 tests passed.`);
  console.log("============================================================\n");
}

runStage1Tests()
  .catch(err => {
    console.error("Test failed:", err);
    process.exit(1);
  })
  .finally(() => pool.end());
