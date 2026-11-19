/**
 * StudyReader — Verification Suite for the 3 Core Fixes:
 * 1. DOCX/PPTX Processing, Section/Slide Structuring & RAG
 * 2. AI Tutor Chat Persistence & Restoration (Neon PostgreSQL)
 * 3. AI Multi-Provider Router, Fallback & Truthful Admin Matrix
 */

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "../.env") });
const fs = require("fs");
const assert = require("assert");
const { Pool } = require("pg");
const JSZip = require("jszip");

const documentProcessor = require("../services/document/document-processor");
const aiProviderRouter = require("../services/ai/ai-provider-router");
const geminiAdapter = require("../services/ai/adapters/gemini-adapter");
const groqAdapter = require("../services/ai/adapters/groq-adapter");
const cloudflareAdapter = require("../services/ai/adapters/cloudflare-adapter");
const { batchGenerateEmbeddings } = require("../services/ai/embedding-service");
const { createChunks } = require("../services/ai/rag-service");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

let passedTests = 0;
let totalTests = 0;

function it(desc, fn) {
  totalTests++;
  try {
    fn();
    console.log(`  \x1b[32m✔\x1b[0m ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  \x1b[31m✖\x1b[0m ${desc}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function itAsync(desc, fn) {
  totalTests++;
  try {
    await fn();
    console.log(`  \x1b[32m✔\x1b[0m ${desc}`);
    passedTests++;
  } catch (err) {
    console.error(`  \x1b[31m✖\x1b[0m ${desc}`);
    console.error(`    Error: ${err.message}`);
  }
}

async function runSuite() {
  console.log("\n============================================================");
  console.log("  STUDYREADER 3-TASK VERIFICATION SUITE");
  console.log("============================================================\n");

  // ============================================================
  // TASK 1: DOCX & PPTX EXTRACTION, STRUCTURING & RAG
  // ============================================================
  console.log("📌 TASK 1: DOCX & PPTX Extraction and Structuring");

  // 1.1 DOCX Extraction
  const sampleDocxPath = path.join(__dirname, "../uploads/1794928094471-651608589.docx");
  if (fs.existsSync(sampleDocxPath)) {
    await itAsync("DOCX extraction extracts semantic sections, titles, and text", async () => {
      const res = await documentProcessor.extractDocument(sampleDocxPath, "Parallel_Processing.docx");
      assert.strictEqual(res.fileType, "docx", "FileType is docx");
      assert(res.sections.length > 0, "Extracted sections exist");
      assert(res.fullText.length > 100, "Full text extracted");
      assert(res.formattedHtml.includes("docx-study-document"), "Formatted HTML wrapper generated");
      assert(res.sections[0].sectionNumber === 1, "First section has sectionNumber 1");

      const pageChunks = documentProcessor.toPageChunks(res);
      assert.strictEqual(pageChunks.length, res.sections.length, "toPageChunks matches section count");
      assert(pageChunks[0].sectionNumber === 1, "Section chunks carry sectionNumber");
    });
  } else {
    console.log("  ⚠️ Sample docx not found on disk, skipping 1.1");
  }

  // 1.2 PPTX Extraction
  const testPptxPath = path.join(__dirname, "../uploads/test_verification_deck.pptx");
  const zip = new JSZip();
  const slide1Xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Operating Systems & Concurrency</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>Processes and threads share CPU scheduling.</a:t></a:r></a:p><a:p><a:r><a:t>Race conditions occur without mutual exclusion.</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
  const slide2Xml = `<?xml version="1.0" encoding="UTF-8"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld><p:spTree>
    <p:sp><p:nvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:txBody><a:p><a:r><a:t>Semaphores and Mutex Locks</a:t></a:r></a:p></p:txBody></p:sp>
    <p:sp><p:txBody><a:p><a:r><a:t>Dijkstra introduced binary and counting semaphores.</a:t></a:r></a:p></p:txBody></p:sp>
  </p:spTree></p:cSld>
</p:sld>`;
  zip.file("ppt/slides/slide1.xml", slide1Xml);
  zip.file("ppt/slides/slide2.xml", slide2Xml);
  const pptxBuf = await zip.generateAsync({ type: "nodebuffer" });
  fs.writeFileSync(testPptxPath, pptxBuf);

  await itAsync("PPTX extraction extracts slides in order with titles, numbers and bullets", async () => {
    const res = await documentProcessor.extractDocument(testPptxPath, "Operating_Systems.pptx");
    assert.strictEqual(res.fileType, "pptx", "FileType is pptx");
    assert.strictEqual(res.pageCount, 2, "PageCount matches slide count 2");
    assert.strictEqual(res.sections[0].slideNumber, 1, "Slide 1 number");
    assert.strictEqual(res.sections[0].title, "Operating Systems & Concurrency", "Slide 1 title");
    assert.strictEqual(res.sections[1].slideNumber, 2, "Slide 2 number");
    assert.strictEqual(res.sections[1].title, "Semaphores and Mutex Locks", "Slide 2 title");
    assert(res.formattedHtml.includes("pptx-slide-card"), "Formatted HTML includes slide cards");

    const pageChunks = documentProcessor.toPageChunks(res);
    assert.strictEqual(pageChunks.length, 2, "PPTX page chunks count");
    assert.strictEqual(pageChunks[0].slideNumber, 1, "Chunk 1 has slideNumber 1");
    assert.strictEqual(pageChunks[1].slideNumber, 2, "Chunk 2 has slideNumber 2");
  });

  // Clean up test file
  if (fs.existsSync(testPptxPath)) fs.unlinkSync(testPptxPath);

  // 1.3 Chunking & 768-dim Embeddings consistency
  await itAsync("RAG chunking creates slide-aware and section-aware chunks", () => {
    const mockSlides = [
      { slideNumber: 1, text: "Slide 1 Content" },
      { slideNumber: 2, text: "Slide 2 Content" }
    ];
    const chunks = createChunks(mockSlides);
    assert.strictEqual(chunks.length, 2, "2 chunks created");
    assert.strictEqual(chunks[0].slideNumber, 1, "Chunk 1 slideNumber is 1");
    assert.strictEqual(chunks[1].slideNumber, 2, "Chunk 2 slideNumber is 2");
  });

  // ============================================================
  // TASK 2: AI TUTOR CHAT PERSISTENCE (POSTGRESQL)
  // ============================================================
  console.log("\n📌 TASK 2: AI Tutor Chat Persistence & Restoration");

  const testUserId = 20; // System Admin / Test User
  const testDocId = 56;  // Existing test document in DB

  await itAsync("Atomic chat message insertion saves user & assistant messages together", async () => {
    const testQuestion = `Test Question Verification ${Date.now()}`;
    const testAnswer = `Test Tutor Answer Explanation ${Date.now()}`;

    const client = await pool.connect();
    let userMsgId, botMsgId;
    try {
      await client.query("BEGIN");
      const userRes = await client.query(
        `INSERT INTO chat_messages (user_id, pdf_id, role, message)
         VALUES ($1, $2, 'user', $3)
         RETURNING id, role, message`,
        [testUserId, testDocId, testQuestion]
      );
      userMsgId = userRes.rows[0].id;

      const botRes = await client.query(
        `INSERT INTO chat_messages (user_id, pdf_id, role, message)
         VALUES ($1, $2, 'assistant', $3)
         RETURNING id, role, message`,
        [testUserId, testDocId, testAnswer]
      );
      botMsgId = botRes.rows[0].id;
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }

    assert(userMsgId && botMsgId, "Both messages inserted with IDs");

    // Verify ordering: GET /api/pdfs/:id/chat logic
    const historyRes = await pool.query(
      `SELECT id, role, message
       FROM chat_messages
       WHERE user_id = $1 AND pdf_id = $2
       ORDER BY created_at ASC, id ASC`,
      [testUserId, testDocId]
    );

    const msgs = historyRes.rows;
    assert(msgs.length >= 2, "History contains inserted messages");
    const lastUser = msgs.find(m => m.id === userMsgId);
    const lastBot = msgs.find(m => m.id === botMsgId);

    assert(lastUser && lastBot, "Both messages retrieved from PostgreSQL");
    assert(parseInt(lastUser.id, 10) < parseInt(lastBot.id, 10), "User message precedes Assistant message");

    // Clean up test verification messages
    await pool.query("DELETE FROM chat_messages WHERE id IN ($1, $2)", [userMsgId, botMsgId]);
  });

  // ============================================================
  // TASK 3: MULTI-PROVIDER AI CONFIGURATION & ADMIN MATRIX
  // ============================================================
  console.log("\n📌 TASK 3: Multi-Provider AI Configuration & Truthful Status");

  // 3.1 Check Provider Availability
  it("Adapter credential detection identifies configured keys", () => {
    assert.strictEqual(typeof geminiAdapter.isAvailable(), "boolean", "Gemini isAvailable is boolean");
    assert.strictEqual(typeof groqAdapter.isAvailable(), "boolean", "Groq isAvailable is boolean");
    assert.strictEqual(typeof cloudflareAdapter.isAvailable(), "boolean", "Cloudflare isAvailable is boolean");
  });

  // 3.2 Real Provider Invocations
  await itAsync("Gemini Primary Provider generates live response", async () => {
    if (geminiAdapter.isAvailable()) {
      const res = await geminiAdapter.generateText({
        prompt: "Say 'Gemini OK' in 2 words.",
        maxOutputTokens: 16
      });
      assert(res.text && res.text.length > 0, "Gemini returned non-empty response");
      assert.strictEqual(res.provider, "gemini", "Provider is gemini");
    } else {
      console.log("    ℹ Gemini key not set in environment");
    }
  });

  await itAsync("Groq Backup Provider generates live response (real call)", async () => {
    if (groqAdapter.isAvailable()) {
      const res = await groqAdapter.generateText({
        prompt: "Say 'Groq OK' in 2 words.",
        maxOutputTokens: 512
      });
      assert(res.text && res.text.length > 0, "Groq returned non-empty response");
      assert.strictEqual(res.provider, "groq", "Provider is groq");
      assert(res.model.includes("gpt-oss"), "Groq used configured model");
    } else {
      console.log("    ℹ Groq key not set in environment");
    }
  });

  await itAsync("Cloudflare Workers AI Backup Provider generates live response (real call)", async () => {
    if (cloudflareAdapter.isAvailable()) {
      const res = await cloudflareAdapter.generateText({
        prompt: "Say 'Cloudflare OK' in 2 words.",
        maxOutputTokens: 512
      });
      assert(res.text && res.text.length > 0, "Cloudflare returned non-empty response");
      assert.strictEqual(res.provider, "cloudflare", "Provider is cloudflare");
      assert(res.model.includes("llama-3.3-70b"), "Cloudflare used configured model");
    } else {
      console.log("    ℹ Cloudflare credentials not set in environment");
    }
  });

  // 3.3 Automatic Failover Routing Tests
  await itAsync("Automatic failover routes to Groq when Gemini fails", async () => {
    const origGemini = geminiAdapter.generateText;
    geminiAdapter.generateText = async () => {
      const err = new Error("Simulated Gemini 503 Overload");
      err.status = 503;
      err.isRecoverable = true;
      throw err;
    };
    try {
      const res = await aiProviderRouter.generateWithFallback({ prompt: "Explain the main benefit of cloud elasticity in one clear sentence." });
      assert.strictEqual(res.fallbackOccurred, true, "Fallback occurred");
      assert.strictEqual(res.provider, "groq", "Fallback resolved by Groq");
    } finally {
      geminiAdapter.generateText = origGemini;
      aiProviderRouter.clearCooldowns();
    }
  });

  await itAsync("Automatic failover routes to Cloudflare when Gemini and Groq fail", async () => {
    const origGemini = geminiAdapter.generateText;
    const origGroq = groqAdapter.generateText;
    geminiAdapter.generateText = async () => {
      const err = new Error("Simulated Gemini 429 Quota");
      err.status = 429;
      err.isRecoverable = true;
      throw err;
    };
    groqAdapter.generateText = async () => {
      const err = new Error("Simulated Groq 503 Overload");
      err.status = 503;
      err.isRecoverable = true;
      throw err;
    };
    try {
      const res = await aiProviderRouter.generateWithFallback({ prompt: "Explain the main benefit of cloud scalability in one clear sentence." });
      assert.strictEqual(res.fallbackOccurred, true, "Fallback occurred");
      assert.strictEqual(res.provider, "cloudflare", "Fallback resolved by Cloudflare");
    } finally {
      geminiAdapter.generateText = origGemini;
      groqAdapter.generateText = origGroq;
      aiProviderRouter.clearCooldowns();
    }
  });

  // 3.3 Diagnostic Provider Test function
  await itAsync("testProvider diagnostic function reports accurate status", async () => {
    const groqTest = await aiProviderRouter.testProvider("groq");
    assert.strictEqual(groqTest.provider, "groq", "Provider is groq");
    if (groqAdapter.isAvailable()) {
      assert.strictEqual(groqTest.success, true, "Groq live diagnostic test succeeded");
      assert(groqTest.latencyMs > 0, "Latency tracked");
    } else {
      assert.strictEqual(groqTest.configured, false, "Groq reported unconfigured");
    }
  });

  // 3.4 Truthful Status & No Fabricated 100% Metrics
  it("getProviderStatus returns truthful metrics without fabricated 100%", () => {
    const status = aiProviderRouter.getProviderStatus();
    assert(status.providers.gemini, "Gemini provider status present");
    assert(status.providers.groq, "Groq provider status present");
    assert(status.providers.cloudflare, "Cloudflare provider status present");

    for (const [key, p] of Object.entries(status.providers)) {
      if (p.totalRequests === 0) {
        assert.strictEqual(p.successRate, null, `${key} successRate is null when totalRequests == 0 (not 100%)`);
        assert.strictEqual(p.avgLatencyMs, null, `${key} avgLatencyMs is null when totalRequests == 0`);
      } else {
        assert(typeof p.successRate === "number", `${key} successRate is number`);
      }
    }
  });

  await pool.end();

  console.log("\n============================================================");
  console.log(`  RESULTS: ${passedTests} / ${totalTests} tests passed.`);
  console.log("============================================================\n");
}

runSuite().catch(e => {
  console.error("Test suite fatal error:", e);
  pool.end();
  process.exit(1);
});
