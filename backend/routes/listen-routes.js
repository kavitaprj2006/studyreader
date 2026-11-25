/**
 * StudyReader Listen — Dedicated API Routes
 * 
 * Endpoints for natural reading blocks, neural voice synthesis,
 * listening history, bookmarks, and pronunciation overrides.
 */

const express = require("express");
const textNormalizer = require("../services/audio/text-normalizer");
const TTSService = require("../services/audio/tts-service");
const OCRService = require("../services/ocr/ocr-service");

function createListenRouter({ pool, cloudStorage, canAccessDocument, requireAuth, documentProcessor, getDocumentLocalPath }) {
  const router = express.Router();
  const ttsService = new TTSService(pool, cloudStorage);
  const ocrService = documentProcessor?.ocrService || new OCRService(pool, cloudStorage);

  // ============================================================
  // 1. GET /api/listen/voices — Available Neural & Browser Voices
  // ============================================================
  router.get("/voices", requireAuth, async (req, res) => {
    try {
      const voices = await ttsService.getAvailableVoices();
      return res.status(200).json({
        success: true,
        voices
      });
    } catch (err) {
      console.error("[ListenAPI] Failed to fetch voices:", err);
      return res.status(500).json({ success: false, message: "Unable to retrieve voices." });
    }
  });

  // ============================================================
  // 2. GET /api/listen/document/:id/blocks — Structured Reading Blocks
  // ============================================================
  router.get("/document/:id/blocks", requireAuth, async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found or access denied." });
      }

      // Fetch user pronunciation overrides
      const pronRes = await pool.query(
        "SELECT term, phonetic_spoken FROM user_pronunciations WHERE user_id = $1",
        [req.user.id]
      );
      const userOverrides = {};
      pronRes.rows.forEach(r => { userOverrides[r.term] = r.phonetic_spoken; });

      // Fast-path: Check if document chunks are already stored in database (from JobProcessor/OCR)
      let sections = [];
      let fileType = "pdf";
      let pageCount = 1;

      try {
        const chunksRes = await pool.query(
          "SELECT chunk_index, page_start, page_end, content FROM pdf_chunks WHERE pdf_id = $1 ORDER BY chunk_index ASC",
          [document.id]
        );

        if (chunksRes.rows && chunksRes.rows.length > 0) {
          const pageMap = new Map();
          chunksRes.rows.forEach(c => {
            const p = c.page_start || 1;
            if (!pageMap.has(p)) pageMap.set(p, []);
            if (c.content && c.content.trim()) {
              pageMap.get(p).push(c.content.trim());
            }
          });
          for (const [pageNum, textArr] of pageMap.entries()) {
            sections.push({
              pageNumber: pageNum,
              title: `Page ${pageNum}`,
              text: textArr.join("\n\n")
            });
          }
          pageCount = sections.length;
        }
      } catch (chunkErr) {
        console.warn("[ListenAPI] pdf_chunks query error, falling back to extraction:", chunkErr.message);
      }

      // Fallback: If no stored chunks, extract document text using documentProcessor
      if (sections.length === 0) {
        const { filePath, isTemp } = await getDocumentLocalPath(document);
        let extracted;
        try {
          extracted = await documentProcessor.extractDocument(filePath, document.original_filename || document.filename);
        } finally {
          if (isTemp && require("fs").existsSync(filePath)) {
            try { require("fs").unlinkSync(filePath); } catch (_) {}
          }
        }
        sections = extracted.sections || [];
        fileType = extracted.fileType || "pdf";
        pageCount = extracted.pageCount || sections.length || 1;
      }

      // Generate structured reading blocks
      const blocks = textNormalizer.createReadingBlocks(sections, `doc_${document.id}`, userOverrides);

      return res.status(200).json({
        success: true,
        documentId: document.id,
        title: document.original_filename || document.filename,
        fileType,
        pageCount,
        totalBlocks: blocks.length,
        blocks
      });

    } catch (err) {
      console.error("[ListenAPI] Failed to generate reading blocks:", err);
      return res.status(500).json({ success: false, message: err.message || "Failed to process reading blocks." });
    }
  });

  // ============================================================
  // 3. POST /api/listen/document/:id/synthesize — Neural Synthesis
  // ============================================================
  router.post("/document/:id/synthesize", requireAuth, async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found or access denied." });
      }

      const { text, voice = "cf:luna", speed = 1.0, pageNumber = 1, chunkIndex = 0 } = req.body;
      if (!text || !String(text).trim()) {
        return res.status(400).json({ success: false, message: "Text is required for speech synthesis." });
      }

      // Fetch user pronunciation overrides
      const pronRes = await pool.query(
        "SELECT term, phonetic_spoken FROM user_pronunciations WHERE user_id = $1",
        [req.user.id]
      );
      const userOverrides = {};
      pronRes.rows.forEach(r => { userOverrides[r.term] = r.phonetic_spoken; });

      const result = await ttsService.synthesizeChunk({
        pdfId: document.id,
        pageNumber: Number(pageNumber) || 1,
        chunkIndex: Number(chunkIndex) || 0,
        text,
        voice,
        speed: Number(speed) || 1.0,
        userOverrides
      });

      if (result.useClientSynthesis || !result.audioBuffer) {
        return res.status(200).json({
          success: true,
          useClientSynthesis: true,
          normalizedText: result.normalizedText,
          voice,
          speed
        });
      }

      res.set("Content-Type", result.contentType || "audio/mpeg");
      res.set("X-Cache-Hit", result.cacheHit ? "HIT" : "MISS");
      res.set("Cache-Control", "private, max-age=86400");
      return res.status(200).send(result.audioBuffer);

    } catch (err) {
      console.error("[ListenAPI] Synthesis error:", err);
      return res.status(200).json({
        success: true,
        useClientSynthesis: true,
        normalizedText: text,
        fallbackReason: err.message || "Speech synthesis provider unavailable."
      });
    }
  });

  // ============================================================
  // 4. LISTENING HISTORY & PROGRESS
  // ============================================================
  router.get("/history/:id", requireAuth, async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found." });
      }

      const historyRes = await pool.query(
        `SELECT last_page, last_block_id, last_audio_timestamp, completion_percentage,
                total_listened_seconds, voice_used, speed_used, last_listened_at
         FROM listening_history
         WHERE user_id = $1 AND pdf_id = $2
         LIMIT 1`,
        [req.user.id, document.id]
      );

      return res.status(200).json({
        success: true,
        history: historyRes.rows[0] || null
      });
    } catch (err) {
      console.error("[ListenAPI] History fetch error:", err);
      return res.status(500).json({ success: false, message: "Failed to fetch listening history." });
    }
  });

  router.post("/history/:id", requireAuth, async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found." });
      }

      const {
        lastPage = 1,
        lastBlockId = null,
        lastAudioTimestamp = 0,
        completionPercentage = 0,
        additionalSeconds = 0,
        voiceUsed = "cf:luna",
        speedUsed = 1.0
      } = req.body;

      await pool.query(
        `INSERT INTO listening_history (user_id, pdf_id, last_page, last_block_id, last_audio_timestamp, completion_percentage, total_listened_seconds, voice_used, speed_used, last_listened_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
         ON CONFLICT (user_id, pdf_id)
         DO UPDATE SET
           last_page = EXCLUDED.last_page,
           last_block_id = EXCLUDED.last_block_id,
           last_audio_timestamp = EXCLUDED.last_audio_timestamp,
           completion_percentage = GREATEST(listening_history.completion_percentage, EXCLUDED.completion_percentage),
           total_listened_seconds = listening_history.total_listened_seconds + EXCLUDED.total_listened_seconds,
           voice_used = EXCLUDED.voice_used,
           speed_used = EXCLUDED.speed_used,
           last_listened_at = NOW()`,
        [
          req.user.id,
          document.id,
          Number(lastPage) || 1,
          lastBlockId,
          Number(lastAudioTimestamp) || 0,
          Number(completionPercentage) || 0,
          Number(additionalSeconds) || 0,
          voiceUsed,
          Number(speedUsed) || 1.0
        ]
      );

      return res.status(200).json({ success: true, message: "Listening progress saved." });
    } catch (err) {
      console.error("[ListenAPI] History save error:", err);
      return res.status(500).json({ success: false, message: "Failed to update listening progress." });
    }
  });

  // ============================================================
  // 5. BOOKMARKS & PERSONAL NOTES
  // ============================================================
  router.get("/bookmarks/:id", requireAuth, async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found." });
      }

      const result = await pool.query(
        `SELECT id, page_number, block_id, audio_timestamp, title, note, created_at
         FROM listening_bookmarks
         WHERE user_id = $1 AND pdf_id = $2
         ORDER BY page_number ASC, created_at ASC`,
        [req.user.id, document.id]
      );

      return res.status(200).json({ success: true, bookmarks: result.rows });
    } catch (err) {
      console.error("[ListenAPI] Bookmarks fetch error:", err);
      return res.status(500).json({ success: false, message: "Failed to fetch bookmarks." });
    }
  });

  router.post("/bookmarks/:id", requireAuth, async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found." });
      }

      const { pageNumber = 1, blockId = null, audioTimestamp = 0, title, note = "" } = req.body;
      if (!title || !title.trim()) {
        return res.status(400).json({ success: false, message: "Title is required for bookmark." });
      }

      const insertRes = await pool.query(
        `INSERT INTO listening_bookmarks (user_id, pdf_id, page_number, block_id, audio_timestamp, title, note)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, page_number, block_id, audio_timestamp, title, note, created_at`,
        [
          req.user.id,
          document.id,
          Number(pageNumber) || 1,
          blockId,
          Number(audioTimestamp) || 0,
          title.trim(),
          note ? note.trim() : null
        ]
      );

      return res.status(201).json({ success: true, bookmark: insertRes.rows[0] });
    } catch (err) {
      console.error("[ListenAPI] Bookmark save error:", err);
      return res.status(500).json({ success: false, message: "Failed to save bookmark." });
    }
  });

  router.delete("/bookmarks/:id/:bookmarkId", requireAuth, async (req, res) => {
    try {
      await pool.query(
        "DELETE FROM listening_bookmarks WHERE id = $1 AND user_id = $2 AND pdf_id = $3",
        [req.params.bookmarkId, req.user.id, req.params.id]
      );
      return res.status(200).json({ success: true, message: "Bookmark removed." });
    } catch (err) {
      console.error("[ListenAPI] Bookmark delete error:", err);
      return res.status(500).json({ success: false, message: "Failed to delete bookmark." });
    }
  });

  // ============================================================
  // 6. PRONUNCIATION DICTIONARY OVERRIDES
  // ============================================================
  router.get("/pronunciations", requireAuth, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, term, phonetic_spoken, category, created_at FROM user_pronunciations WHERE user_id = $1 ORDER BY term ASC",
        [req.user.id]
      );
      return res.status(200).json({ success: true, pronunciations: result.rows });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Failed to retrieve pronunciations." });
    }
  });

  router.post("/pronunciations", requireAuth, async (req, res) => {
    try {
      const { term, phoneticSpoken, category = "general" } = req.body;
      if (!term || !phoneticSpoken) {
        return res.status(400).json({ success: false, message: "Term and phoneticSpoken are required." });
      }

      await pool.query(
        `INSERT INTO user_pronunciations (user_id, term, phonetic_spoken, category)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, term)
         DO UPDATE SET phonetic_spoken = EXCLUDED.phonetic_spoken, category = EXCLUDED.category`,
        [req.user.id, term.trim(), phoneticSpoken.trim(), category]
      );

      return res.status(200).json({ success: true, message: "Pronunciation override saved." });
    } catch (err) {
      return res.status(500).json({ success: false, message: "Failed to save pronunciation." });
    }
  });

  // ============================================================
  // 7. OCR & SCANNED DOCUMENT QUALITY & CORRECTION
  // ============================================================
  router.get("/document/:id/ocr", requireAuth, async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found or access denied." });
      }

      const metadata = await ocrService.getOcrMetadata(document.id);
      return res.status(200).json({
        success: true,
        documentId: document.id,
        pages: metadata
      });
    } catch (err) {
      console.error("[ListenAPI] OCR metadata retrieval error:", err);
      return res.status(500).json({ success: false, message: "Failed to retrieve OCR metadata." });
    }
  });

  router.post("/document/:id/ocr/page/:pageNumber/correct", requireAuth, async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found or access denied." });
      }

      const pageNumber = parseInt(req.params.pageNumber, 10);
      const { correctedText } = req.body;
      if (!correctedText || typeof correctedText !== "string") {
        return res.status(400).json({ success: false, message: "correctedText string is required." });
      }

      const updated = await ocrService.correctOcrPage(document.id, pageNumber, correctedText.trim());
      return res.status(200).json({
        success: true,
        message: "OCR text correction saved.",
        page: updated
      });
    } catch (err) {
      console.error("[ListenAPI] OCR correction error:", err);
      return res.status(500).json({ success: false, message: "Failed to save OCR correction." });
    }
  });

  router.post("/document/:id/ocr/page/:pageNumber/retry", requireAuth, async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
      if (!document) {
        return res.status(404).json({ success: false, message: "Document not found or access denied." });
      }

      const pageNumber = parseInt(req.params.pageNumber, 10);
      const { language = "eng" } = req.body;

      const { filePath, isTemp } = await getDocumentLocalPath(document);
      let retryResult;
      try {
        retryResult = await ocrService.retryOcrPage(document.id, pageNumber, language, filePath);
      } finally {
        if (isTemp && require("fs").existsSync(filePath)) {
          try { require("fs").unlinkSync(filePath); } catch (_) {}
        }
      }

      return res.status(200).json({
        success: true,
        message: `OCR page ${pageNumber} re-processed with language ${language}.`,
        result: retryResult
      });
    } catch (err) {
      console.error("[ListenAPI] OCR retry error:", err);
      return res.status(500).json({ success: false, message: "Failed to retry OCR processing." });
    }
  });

  // ============================================================
  // 8. DIAGNOSTICS & TELEMETRY FOR ADMIN
  // ============================================================
  router.get("/telemetry", requireAuth, (req, res) => {
    if (req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Admin access required." });
    }
    return res.status(200).json({
      success: true,
      telemetry: {
        tts: ttsService.getTelemetry(),
        ocr: ocrService.getTelemetry()
      }
    });
  });

  return router;
}

module.exports = createListenRouter;
