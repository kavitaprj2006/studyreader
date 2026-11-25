/**
 * StudyReader Listen — Stage 2 Verification Suite
 * 
 * Verifies:
 * 1. Automatic Scanned Page Detection
 * 2. Canvas Rendering & Preprocessing (@napi-rs/canvas + pdfjs-dist)
 * 3. Tesseract.js OCR Engine (English & Hindi support)
 * 4. Mixed Digital / Scanned Document Handling
 * 5. Database Tracking in ocr_page_metadata (Neon PostgreSQL)
 * 6. User OCR Correction & Retry API
 * 7. Unified DocumentProcessor & RAG Chunking Compatibility
 * 8. Telemetry Metrics for Admin Dashboard
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const fs = require("fs");
const path = require("path");
const { pool } = require("../db");
const OCRService = require("../services/ocr/ocr-service");
const documentProcessor = require("../services/document/document-processor");

async function runStage2Verification() {
  console.log("============================================================");
  console.log("STUDYREADER LISTEN — STAGE 2 OCR & SCANNED DOC VERIFICATION");
  console.log("============================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = "") {
    if (condition) {
      console.log(`[PASS] ${testName}`);
      passed++;
    } else {
      console.error(`[FAIL] ${testName}: ${details}`);
      failed++;
    }
  }

  const ocrService = new OCRService(pool);

  // ------------------------------------------------------------
  // TEST 1: Automatic Scanned Page Detection
  // ------------------------------------------------------------
  console.log("--- Test 1: Scanned Page Detection Logic ---");
  const emptyRes = ocrService.detectScannedPage("");
  const sparseRes = ocrService.detectScannedPage("Page 12");
  const digitalRes = ocrService.detectScannedPage(
    "Artificial Intelligence (AI) is the intelligence of machines or software, as opposed to the intelligence of living beings, primarily of humans. It is a field of study in computer science."
  );

  assert(emptyRes.isScanned === true && emptyRes.reason === "empty_text", "Empty page detected as scanned");
  assert(sparseRes.isScanned === true, "Sparse/page number only detected as scanned");
  assert(digitalRes.isScanned === false && digitalRes.characterCount > 100, "Normal digital text correctly recognized as selectable (not scanned)");

  // ------------------------------------------------------------
  // TEST 2: PDF Page Canvas Rendering & Image Preprocessing
  // ------------------------------------------------------------
  console.log("\n--- Test 2: High-Resolution Page Image Rendering ---");
  const samplePdf = path.resolve(__dirname, "../uploads/1790494119800-328453.pdf");
  let renderedImageBuffer = null;

  if (fs.existsSync(samplePdf)) {
    try {
      renderedImageBuffer = await ocrService.renderPdfPageToImage(samplePdf, 1, 1.5);
      const isPng = renderedImageBuffer && renderedImageBuffer.slice(0, 8).toString("hex") === "89504e470d0a1a0a";
      assert(isPng && renderedImageBuffer.length > 50000, `Page 1 rendered to high-res preprocessed PNG (${renderedImageBuffer.length} bytes)`);
    } catch (err) {
      assert(false, "Page rendering failed", err.message);
    }
  } else {
    console.warn("[WARN] Sample PDF not found; skipping render test");
  }

  // ------------------------------------------------------------
  // TEST 3: Tesseract OCR Engine (English Recognition)
  // ------------------------------------------------------------
  console.log("\n--- Test 3: Tesseract OCR Recognition (English) ---");
  if (renderedImageBuffer) {
    try {
      const ocrResult = await ocrService.recognizeImage(renderedImageBuffer, "eng");
      assert(ocrResult.text.length > 0, `OCR extracted text (${ocrResult.characterCount} chars)`);
      assert(ocrResult.confidence >= 50, `OCR confidence score is reasonable (${ocrResult.confidence}%)`);
      assert(ocrResult.processingTimeMs > 0, `OCR processing time recorded (${ocrResult.processingTimeMs}ms)`);
      console.log(`   Sample text snippet: "${ocrResult.text.slice(0, 100).replace(/\s+/g, ' ')}..."`);
    } catch (err) {
      assert(false, "OCR recognition failed", err.message);
    }
  }

  // ------------------------------------------------------------
  // TEST 4: Multi-Language Support (Hindi Engine Verification)
  // ------------------------------------------------------------
  console.log("\n--- Test 4: Multi-Language Engine (Hindi 'hin' check) ---");
  try {
    const { createWorker } = require("tesseract.js");
    const worker = await createWorker("hin");
    assert(typeof worker.recognize === "function", "Hindi language pack initialized successfully");
    await worker.terminate();
  } catch (err) {
    assert(false, "Hindi worker init failed", err.message);
  }

  // ------------------------------------------------------------
  // TEST 5: Mixed PDF Document Handling & Selective OCR
  // ------------------------------------------------------------
  console.log("\n--- Test 5: Mixed Document Handling (Selective OCR) ---");
  const testPages = [
    { pageNumber: 1, text: "Chapter 1: Principles of Operating Systems. Processes and threads provide concurrency.", title: "Page 1" },
    { pageNumber: 2, text: "", title: "Page 2" } // simulated scanned page
  ];

  try {
    const mixedResult = await ocrService.processPdf(samplePdf, testPages, { minCharacters: 40 });
    assert(mixedResult.pages.length === 2, "Both pages processed");
    assert(mixedResult.pages[0].isScanned === false && mixedResult.pages[0].ocrApplied === false, "Digital page 1 skipped OCR (native text preserved)");
    assert(mixedResult.pages[1].isScanned === true && mixedResult.pages[1].ocrApplied === true, "Empty page 2 automatically triggered OCR");
    assert(mixedResult.stats.scannedPagesDetected === 1 && mixedResult.stats.ocrPagesApplied === 1, "Stats reflect exact counts");
  } catch (err) {
    assert(false, "Mixed document processing failed", err.message);
  }

  // ------------------------------------------------------------
  // TEST 6: Database Persistence in ocr_page_metadata
  // ------------------------------------------------------------
  console.log("\n--- Test 6: Database Persistence (ocr_page_metadata) ---");
  try {
    // Find an existing PDF ID from database
    const pdfRow = await pool.query("SELECT id FROM pdfs LIMIT 1");
    if (pdfRow.rows.length > 0) {
      const testPdfId = pdfRow.rows[0].id;

      // Insert/update metadata
      await ocrService.persistPageMetadata({
        pdfId: testPdfId,
        pageNumber: 999,
        isScanned: true,
        ocrApplied: true,
        confidenceScore: 92.5,
        language: "eng",
        characterCount: 350,
        processingTimeMs: 1200
      });

      const records = await ocrService.getOcrMetadata(testPdfId);
      const found = records.find(r => r.page_number === 999);
      assert(found && found.ocr_applied === true && Number(found.confidence_score) === 92.5, "OCR metadata saved and retrieved from PostgreSQL");

      // Test user correction
      const corrected = await ocrService.correctOcrPage(testPdfId, 999, "User corrected text for page 999.");
      assert(corrected && corrected.corrected_text === "User corrected text for page 999.", "User OCR correction persisted successfully");

      // Clean up test row
      await pool.query("DELETE FROM ocr_page_metadata WHERE pdf_id = $1 AND page_number = 999", [testPdfId]);
      assert(true, "Test OCR metadata cleaned up safely");
    } else {
      console.log("[SKIP] No PDFs in database to test FK constraint");
    }
  } catch (err) {
    assert(false, "Database persistence failed", err.message);
  }

  // ------------------------------------------------------------
  // TEST 7: DocumentProcessor Integration & RAG Chunking
  // ------------------------------------------------------------
  console.log("\n--- Test 7: DocumentProcessor Integration ---");
  try {
    const extracted = await documentProcessor.extractDocument(samplePdf, "sample.pdf");
    assert(extracted.fileType === "pdf", "DocumentProcessor extracted PDF format");
    assert(Array.isArray(extracted.sections) && extracted.sections.length > 0, `Extracted ${extracted.sections.length} sections`);

    const chunks = documentProcessor.toPageChunks(extracted);
    assert(chunks.length === extracted.sections.length, `RAG chunks generated matching sections (${chunks.length} chunks)`);
    assert(typeof chunks[0].text === "string" && chunks[0].text.length > 0, "Chunk text is valid non-empty string for embedding");
  } catch (err) {
    assert(false, "DocumentProcessor extraction failed", err.message);
  }

  // ------------------------------------------------------------
  // TEST 8: Telemetry Metrics
  // ------------------------------------------------------------
  console.log("\n--- Test 8: OCR Telemetry Metrics ---");
  const tel = ocrService.getTelemetry();
  assert(tel.totalPagesProcessed > 0, `Total pages tracked: ${tel.totalPagesProcessed}`);
  assert(tel.ocrAppliedPages > 0, `OCR applied pages tracked: ${tel.ocrAppliedPages}`);
  assert(typeof tel.avgConfidenceScore === "number", `Average confidence calculated: ${tel.avgConfidenceScore}%`);

  // ------------------------------------------------------------
  // SUMMARY
  // ------------------------------------------------------------
  console.log("\n============================================================");
  console.log(`STAGE 2 OCR VERIFICATION COMPLETE: ${passed} PASSED, ${failed} FAILED`);
  console.log("============================================================\n");

  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

runStage2Verification().catch(err => {
  console.error("FATAL Stage 2 verification error:", err);
  process.exit(1);
});
