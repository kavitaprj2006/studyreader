/**
 * StudyReader — OCR & Scanned Document Processing Service
 * 
 * Provides automated detection of scanned/image-based PDF pages,
 * high-resolution canvas rendering with image preprocessing,
 * multi-language OCR recognition (English and Hindi) via Tesseract.js,
 * page-level quality tracking in PostgreSQL, and non-blocking integration.
 */

const fs = require("fs");
const path = require("path");

class OCRService {
  /**
   * @param {object} pool - PostgreSQL connection pool
   * @param {object} cloudStorage - Cloud storage service for document access
   */
  constructor(pool = null, cloudStorage = null) {
    this.pool = pool;
    this.cloudStorage = cloudStorage;

    // In-memory operational metrics
    this.telemetry = {
      totalDocumentsProcessed: 0,
      totalPagesProcessed: 0,
      scannedPagesDetected: 0,
      ocrAppliedPages: 0,
      successfulPages: 0,
      failedPages: 0,
      lowConfidencePages: 0, // confidence < 60
      totalProcessingTimeMs: 0,
      totalConfidenceScore: 0
    };
  }

  /**
   * Evaluates whether a page contains insufficient or no selectable text,
   * indicating a scanned page or non-searchable image.
   * 
   * @param {string} text - Extracted raw text from page
   * @param {object} options
   * @returns {object} { isScanned: boolean, characterCount: number, reason: string }
   */
  detectScannedPage(text = "", options = {}) {
    const minChars = options.minCharacters || 40;
    const clean = String(text || "").replace(/\s+/g, " ").trim();
    const characterCount = clean.length;

    // Check 1: Completely empty or fewer than minChars
    if (characterCount === 0) {
      return { isScanned: true, characterCount: 0, reason: "empty_text" };
    }

    if (characterCount < minChars) {
      // Check if it's just a lonely page number like "Page 1" or "2"
      if (/^(page\s*)?\d{1,4}$/i.test(clean) || characterCount < 15) {
        return { isScanned: true, characterCount, reason: "minimal_text_or_page_number_only" };
      }
      return { isScanned: true, characterCount, reason: "insufficient_text_density" };
    }

    // Check 2: High ratio of non-alphanumeric / corrupted characters (e.g. garbled font encoding)
    const alphanumericCount = (clean.match(/[a-zA-Z0-9\u0900-\u097F]/g) || []).length;
    const alphaRatio = alphanumericCount / characterCount;
    if (alphaRatio < 0.35 && characterCount < 100) {
      return { isScanned: true, characterCount, reason: "corrupted_font_or_symbols" };
    }

    return { isScanned: false, characterCount, reason: "sufficient_selectable_text" };
  }

  /**
   * Preprocesses canvas pixels for optimal Tesseract OCR accuracy:
   * - Converts to luminance grayscale (ITU-R BT.601)
   * - Stretches histogram contrast
   * - Applies adaptive contrast thresholding
   */
  preprocessCanvas(canvas) {
    try {
      const ctx = canvas.getContext("2d");
      const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imgData.data;
      const len = data.length;

      // Find min and max luminance for contrast stretching
      let minLum = 255;
      let maxLum = 0;

      for (let i = 0; i < len; i += 4) {
        const lum = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
        if (lum < minLum) minLum = lum;
        if (lum > maxLum) maxLum = lum;
      }

      const lumRange = maxLum - minLum || 1;

      // Apply grayscale + contrast expansion
      for (let i = 0; i < len; i += 4) {
        let lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        // Contrast stretch
        lum = ((lum - minLum) / lumRange) * 255;

        // Gentle binarization/sharpening: push near-whites to pure white, near-darks to dark
        if (lum > 210) lum = 255;
        else if (lum < 70) lum = Math.max(0, lum - 30);

        data[i] = lum;
        data[i + 1] = lum;
        data[i + 2] = lum;
      }

      ctx.putImageData(imgData, 0, 0);
    } catch (err) {
      // If canvas pixel manipulation is unsupported in environment, proceed with raw render
      console.warn("[OCRService] Image preprocessing skipped:", err.message);
    }
  }

  /**
   * Renders a specific page of a PDF file to a PNG image buffer.
   * 
   * @param {string|Buffer} pdfInput - File path or buffer of the PDF
   * @param {number} pageNumber - 1-based page number
   * @param {number} scale - Rendering scale (1.5 = ~225 DPI)
   * @returns {Promise<Buffer>} PNG image buffer
   */
  async renderPdfPageToImage(pdfInput, pageNumber, scale = 1.5) {
    const { createCanvas } = require("@napi-rs/canvas");
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");

    let data;
    if (Buffer.isBuffer(pdfInput)) {
      data = new Uint8Array(pdfInput);
    } else {
      data = new Uint8Array(fs.readFileSync(pdfInput));
    }

    const doc = await pdfjs.getDocument({
      data,
      disableFontFace: true,
      useSystemFonts: true
    }).promise;

    if (pageNumber < 1 || pageNumber > doc.numPages) {
      throw new Error(`Requested page ${pageNumber} exceeds document page count of ${doc.numPages}.`);
    }

    const page = await doc.getPage(pageNumber);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.floor(viewport.width), Math.floor(viewport.height));
    const canvasContext = canvas.getContext("2d");

    // Fill white background before rendering
    canvasContext.fillStyle = "#ffffff";
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      canvasContext,
      viewport
    }).promise;

    // Apply grayscale + contrast enhancement
    this.preprocessCanvas(canvas);

    return canvas.toBuffer("image/png");
  }

  /**
   * High-accuracy Vision AI fallback for handwritten notes, equations,
   * or degraded photocopies where classical Tesseract OCR confidence is low.
   * 
   * @param {Buffer} imageBuffer - PNG or JPEG image buffer
   * @returns {Promise<object|null>}
   */
  async recognizeWithGeminiVision(imageBuffer) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) return null;

    const startTime = Date.now();
    try {
      const b64 = imageBuffer.toString("base64");
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              { inlineData: { mimeType: "image/png", data: b64 } },
              { text: "Transcribe all printed and handwritten academic text accurately line-by-line. Output only the transcribed text." }
            ]
          }]
        })
      });

      if (!res.ok) return null;
      const data = await res.json();
      const text = data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      if (!text) return null;

      return {
        text,
        confidence: 96.0,
        characterCount: text.length,
        language: "vision",
        processingTimeMs: Date.now() - startTime
      };
    } catch (err) {
      console.warn("[OCRService] Gemini vision fallback skipped:", err.message);
      return null;
    }
  }

  /**
   * Recognizes text from an image buffer using Tesseract.js.
   * Automatically invokes Gemini Vision fallback if handwritten or low-confidence.
   * Supports 'eng' (English) and 'hin' (Hindi).
   * 
   * @param {Buffer} imageBuffer - PNG or JPEG image buffer
   * @param {string} language - Tesseract language code ('eng', 'hin')
   * @returns {Promise<object>} { text, confidence, processingTimeMs }
   */
  async recognizeImage(imageBuffer, language = "eng") {
    const { createWorker } = require("tesseract.js");
    const startTime = Date.now();

    // Sanitize language code
    const lang = (language === "hin" || language === "hindi") ? "hin" : "eng";
    let worker = null;

    try {
      worker = await createWorker(lang);
      const result = await worker.recognize(imageBuffer);

      const processingTimeMs = Date.now() - startTime;
      const text = String(result?.data?.text || "").trim();
      const confidence = Number(result?.data?.confidence) || 0;

      // If Tesseract confidence is low (< 60) or text is minimal, try Vision AI fallback for handwritten notes
      if (confidence < 60 || text.length < 20) {
        const visionResult = await this.recognizeWithGeminiVision(imageBuffer);
        if (visionResult && visionResult.text.length > text.length) {
          console.log(`[OCRService] Enhanced recognition via Gemini Vision (${visionResult.characterCount} chars)`);
          return visionResult;
        }
      }

      return {
        text,
        confidence: Math.round(confidence * 100) / 100,
        characterCount: text.length,
        language: lang,
        processingTimeMs
      };
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (_) {}
      }
    }
  }

  /**
   * Processes a PDF document, running OCR only on scanned/empty pages.
   * Automatically records page quality metadata in PostgreSQL if pdfId is provided.
   * 
   * @param {string} pdfPath - Local path to the PDF file
   * @param {Array<object>} rawPages - Pre-extracted pages [{ pageNumber, text, title }]
   * @param {object} options - { pdfId, language, minCharacters }
   * @returns {Promise<object>} { pages, stats }
   */
  async processPdf(pdfPath, rawPages = [], options = {}) {
    const pdfId = options.pdfId || null;
    const language = options.language || "eng";
    const minChars = options.minCharacters || 40;

    const results = [];
    let scannedDetected = 0;
    let ocrApplied = 0;
    let totalConfidence = 0;
    let totalTime = 0;

    this.telemetry.totalDocumentsProcessed++;

    for (let i = 0; i < rawPages.length; i++) {
      const pageNum = rawPages[i].pageNumber || (i + 1);
      const originalText = rawPages[i].text || "";
      const detection = this.detectScannedPage(originalText, { minCharacters: minChars });

      this.telemetry.totalPagesProcessed++;

      if (!detection.isScanned) {
        // Page has selectable digital text — preserve it without running OCR
        results.push({
          pageNumber: pageNum,
          text: originalText,
          isScanned: false,
          ocrApplied: false,
          confidenceScore: 100.0,
          language: "native",
          characterCount: originalText.length,
          processingTimeMs: 0
        });

        // Store digital page metadata if database is linked
        await this.persistPageMetadata({
          pdfId,
          pageNumber: pageNum,
          isScanned: false,
          ocrApplied: false,
          confidenceScore: 100.0,
          language: "native",
          characterCount: originalText.length,
          processingTimeMs: 0
        });
      } else {
        // Page is scanned or has insufficient text — execute OCR
        scannedDetected++;
        this.telemetry.scannedPagesDetected++;

        try {
          console.log(`[OCRService] Running OCR for Page ${pageNum} of PDF #${pdfId || "local"} (Reason: ${detection.reason})`);
          const imageBuffer = await this.renderPdfPageToImage(pdfPath, pageNum, 1.5);
          const ocrRes = await this.recognizeImage(imageBuffer, language);

          ocrApplied++;
          this.telemetry.ocrAppliedPages++;
          this.telemetry.successfulPages++;
          this.telemetry.totalProcessingTimeMs += ocrRes.processingTimeMs;
          this.telemetry.totalConfidenceScore += ocrRes.confidence;

          if (ocrRes.confidence < 60) {
            this.telemetry.lowConfidencePages++;
          }

          totalConfidence += ocrRes.confidence;
          totalTime += ocrRes.processingTimeMs;

          // Merge OCR text into the page representation
          const chosenText = ocrRes.text.length > 0 ? ocrRes.text : originalText;

          results.push({
            pageNumber: pageNum,
            text: chosenText,
            isScanned: true,
            ocrApplied: true,
            confidenceScore: ocrRes.confidence,
            language: ocrRes.language,
            characterCount: chosenText.length,
            processingTimeMs: ocrRes.processingTimeMs
          });

          await this.persistPageMetadata({
            pdfId,
            pageNumber: pageNum,
            isScanned: true,
            ocrApplied: true,
            confidenceScore: ocrRes.confidence,
            language: ocrRes.language,
            characterCount: chosenText.length,
            processingTimeMs: ocrRes.processingTimeMs
          });

        } catch (ocrErr) {
          console.error(`[OCRService] OCR failed for Page ${pageNum}:`, ocrErr.message);
          this.telemetry.failedPages++;

          // Graceful fallback: do NOT throw or fail document extraction
          results.push({
            pageNumber: pageNum,
            text: originalText || `[Page ${pageNum}: Scanned content could not be read]`,
            isScanned: true,
            ocrApplied: false,
            confidenceScore: 0.0,
            language,
            characterCount: originalText.length,
            processingTimeMs: 0,
            error: ocrErr.message
          });

          await this.persistPageMetadata({
            pdfId,
            pageNumber: pageNum,
            isScanned: true,
            ocrApplied: false,
            confidenceScore: 0.0,
            language,
            characterCount: originalText.length,
            processingTimeMs: 0
          });
        }
      }
    }

    const avgConfidence = ocrApplied > 0 ? Math.round((totalConfidence / ocrApplied) * 100) / 100 : 100.0;

    return {
      pages: results,
      stats: {
        totalPages: rawPages.length,
        scannedPagesDetected: scannedDetected,
        ocrPagesApplied: ocrApplied,
        avgOcrConfidence: avgConfidence,
        totalOcrTimeMs: totalTime
      }
    };
  }

  /**
   * Persists page-level OCR metadata into the ocr_page_metadata table.
   */
  async persistPageMetadata(meta) {
    if (!this.pool || !meta.pdfId) return;

    try {
      const query = `
        INSERT INTO ocr_page_metadata (
          pdf_id,
          page_number,
          is_scanned,
          ocr_applied,
          confidence_score,
          language,
          character_count,
          processing_time_ms
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (pdf_id, page_number)
        DO UPDATE SET
          is_scanned = EXCLUDED.is_scanned,
          ocr_applied = EXCLUDED.ocr_applied,
          confidence_score = EXCLUDED.confidence_score,
          language = EXCLUDED.language,
          character_count = EXCLUDED.character_count,
          processing_time_ms = EXCLUDED.processing_time_ms,
          created_at = NOW();
      `;

      await this.pool.query(query, [
        meta.pdfId,
        meta.pageNumber,
        meta.isScanned,
        meta.ocrApplied,
        meta.confidenceScore,
        meta.language,
        meta.characterCount,
        meta.processingTimeMs
      ]);
    } catch (err) {
      console.warn(`[OCRService] Failed to persist page metadata for PDF #${meta.pdfId} p.${meta.pageNumber}:`, err.message);
    }
  }

  /**
   * Fetches OCR quality records for a document.
   */
  async getOcrMetadata(pdfId) {
    if (!this.pool) return [];

    const res = await this.pool.query(
      `SELECT page_number, is_scanned, ocr_applied, confidence_score, language, character_count, processing_time_ms, corrected_text, created_at
       FROM ocr_page_metadata
       WHERE pdf_id = $1
       ORDER BY page_number ASC`,
      [pdfId]
    );

    return res.rows;
  }

  /**
   * Saves a user-submitted correction for an OCR page.
   */
  async correctOcrPage(pdfId, pageNumber, correctedText) {
    if (!this.pool) throw new Error("Database pool not available");

    const res = await this.pool.query(
      `UPDATE ocr_page_metadata
       SET corrected_text = $1, created_at = NOW()
       WHERE pdf_id = $2 AND page_number = $3
       RETURNING *`,
      [correctedText, pdfId, pageNumber]
    );

    return res.rows[0] || null;
  }

  /**
   * Retries OCR recognition on a specific page with an optional language switch.
   */
  async retryOcrPage(pdfId, pageNumber, language = "eng", localFilePath = null) {
    let filePath = localFilePath;

    if (!filePath && this.cloudStorage) {
      // Fetch storage key
      const docRes = await this.pool.query(
        `SELECT storage_path, file_url FROM pdfs WHERE id = $1`,
        [pdfId]
      );
      if (docRes.rows.length === 0) throw new Error("Document not found");
      const storageKey = docRes.rows[0].storage_path || docRes.rows[0].file_url;
      filePath = await this.cloudStorage.downloadToTemp(storageKey);
    }

    if (!filePath) throw new Error("Could not resolve document file path");

    const imageBuffer = await this.renderPdfPageToImage(filePath, pageNumber, 1.5);
    const ocrRes = await this.recognizeImage(imageBuffer, language);

    await this.persistPageMetadata({
      pdfId,
      pageNumber,
      isScanned: true,
      ocrApplied: true,
      confidenceScore: ocrRes.confidence,
      language: ocrRes.language,
      characterCount: ocrRes.text.length,
      processingTimeMs: ocrRes.processingTimeMs
    });

    return {
      pdfId,
      pageNumber,
      text: ocrRes.text,
      confidenceScore: ocrRes.confidence,
      language: ocrRes.language,
      processingTimeMs: ocrRes.processingTimeMs
    };
  }

  /**
   * Returns aggregated OCR telemetry for the Admin Dashboard.
   */
  getTelemetry() {
    const ocrApplied = this.telemetry.ocrAppliedPages;
    return {
      totalDocumentsProcessed: this.telemetry.totalDocumentsProcessed,
      totalPagesProcessed: this.telemetry.totalPagesProcessed,
      scannedPagesDetected: this.telemetry.scannedPagesDetected,
      ocrAppliedPages: ocrApplied,
      successfulPages: this.telemetry.successfulPages,
      failedPages: this.telemetry.failedPages,
      lowConfidencePages: this.telemetry.lowConfidencePages,
      avgConfidenceScore: ocrApplied > 0 ? Math.round((this.telemetry.totalConfidenceScore / ocrApplied) * 100) / 100 : 100.0,
      avgProcessingTimeMs: ocrApplied > 0 ? Math.round(this.telemetry.totalProcessingTimeMs / ocrApplied) : 0
    };
  }
}

module.exports = OCRService;
