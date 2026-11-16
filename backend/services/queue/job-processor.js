/**
 * StudyReader — Durable PostgreSQL Background Job Processor
 * 
 * Implements resilient background document processing:
 * - Atomic job claiming with FOR UPDATE SKIP LOCKED
 * - Bounded retry attempts with error tracking
 * - Page-aware extraction, chunking, and Gemini 768-dim embeddings
 * - Realtime status updates in PostgreSQL and Firestore
 * - Safe temporary file lifecycle and idempotency
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const officeParser = require("officeparser");
const cloudStorage = require("../storage/cloud-storage");
const { batchGenerateEmbeddings, formatVectorLiteral } = require("../ai/embedding-service");
const { createChunks } = require("../ai/rag-service");

let admin = null;
try {
  admin = require("firebase-admin");
} catch (_) {}

class JobProcessor {
  constructor(pool) {
    this.pool = pool;
    this.workerId = `worker-${process.pid}-${Math.random().toString(36).substring(2, 7)}`;
    this.isPolling = false;
    this.pollTimer = null;
  }

  /**
   * Updates job status and progress in PostgreSQL and Firestore.
   */
  async updateProgress(jobId, pdfId, progress, status = "processing", errorMessage = null) {
    try {
      await this.pool.query(
        `UPDATE document_jobs 
         SET progress = $1, status = $2, error_message = $3, updated_at = NOW() 
         WHERE id = $4`,
        [progress, status, errorMessage, jobId]
      );

      if (pdfId) {
        const docStatus = status === "completed" ? "completed" : (status === "failed" ? "failed" : "processing");
        await this.pool.query(
          `UPDATE pdfs 
           SET processing_status = $1, processing_error = $2, updated_at = NOW() 
           WHERE id = $3`,
          [docStatus, errorMessage, pdfId]
        );
      }

      // Sync realtime status to Firestore if initialized
      if (admin && admin.apps && admin.apps.length > 0) {
        try {
          const firestore = admin.firestore();
          await firestore.collection("document_jobs").doc(String(jobId)).set({
            jobId,
            pdfId,
            status,
            progress,
            errorMessage,
            updatedAt: new Date().toISOString()
          }, { merge: true });
        } catch (_) {
          // Firestore optional
        }
      }
    } catch (err) {
      console.error(`[JobProcessor] Error updating progress for job ${jobId}:`, err.message);
    }
  }

  /**
   * Recovers stale locks from dead workers or timed-out serverless executions.
   */
  async recoverStaleLocks(timeoutMinutes = 5) {
    let recoveredCount = 0;
    try {
      // 1. Re-queue processing jobs where worker died and attempts < max_attempts
      const recoverRes = await this.pool.query(
        `UPDATE document_jobs
         SET status = 'pending',
             locked_at = NULL,
             locked_by = NULL,
             error_message = COALESCE(error_message || ' | ', '') || 'Stale lock recovered after timeout',
             updated_at = NOW()
         WHERE status = 'processing'
           AND locked_at < NOW() - ($1 * INTERVAL '1 minute')
           AND attempts < max_attempts
         RETURNING id`,
        [timeoutMinutes]
      );
      recoveredCount += recoverRes.rows.length;

      // 2. Mark permanently failed jobs that exceeded max_attempts
      const failRes = await this.pool.query(
        `UPDATE document_jobs
         SET status = 'failed',
             locked_at = NULL,
             locked_by = NULL,
             error_message = COALESCE(error_message || ' | ', '') || 'Terminated after exceeding max attempts / stale lock',
             updated_at = NOW()
         WHERE status = 'processing'
           AND locked_at < NOW() - ($1 * INTERVAL '1 minute')
           AND attempts >= max_attempts
         RETURNING id`,
        [timeoutMinutes]
      );

      if (failRes.rows.length > 0) {
        for (const r of failRes.rows) {
          await this.pool.query(
            `UPDATE pdfs SET processing_status = 'failed', processing_error = 'Processing timeout exceeded max retries', updated_at = NOW() WHERE id = (SELECT pdf_id FROM document_jobs WHERE id = $1)`,
            [r.id]
          );
        }
      }

      if (recoveredCount > 0 || failRes.rows.length > 0) {
        console.log(`[JobProcessor] Stale lock recovery: ${recoveredCount} requeued, ${failRes.rows.length} permanently failed.`);
      }
    } catch (err) {
      console.warn(`[JobProcessor] Error in recoverStaleLocks:`, err.message);
    }
    return recoveredCount;
  }

  /**
   * Enqueues a new background document processing job idempotently.
   */
  async enqueueJob(pdfId, jobType = "process_document") {
    // Check if there is already an active (pending or processing) job for this document
    const existing = await this.pool.query(
      `SELECT id, pdf_id, job_type, status, progress, created_at
       FROM document_jobs
       WHERE pdf_id = $1 AND status IN ('pending', 'processing')
       ORDER BY created_at DESC
       LIMIT 1`,
      [pdfId]
    );

    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    const res = await this.pool.query(
      `INSERT INTO document_jobs (pdf_id, job_type, status, progress, attempts, max_attempts)
       VALUES ($1, $2, 'pending', 0, 0, 3)
       RETURNING id, pdf_id, job_type, status, created_at`,
      [pdfId, jobType]
    );
    const job = res.rows[0];

    // Log analytics event
    try {
      await this.pool.query(
        `INSERT INTO analytics_events (event_name, entity_type, entity_id, metadata)
         VALUES ('job_enqueued', 'document_jobs', $1, $2)`,
        [job.id, JSON.stringify({ pdfId, jobType })]
      );
    } catch (_) {}

    return job;
  }

  /**
   * Atomically claims the next pending job using PostgreSQL SKIP LOCKED.
   */
  async claimNextJob() {
    const query = `
      WITH next_job AS (
        SELECT id
        FROM document_jobs
        WHERE status = 'pending'
          AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '5 minutes')
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      UPDATE document_jobs j
      SET status = 'processing',
          attempts = j.attempts + 1,
          locked_at = NOW(),
          locked_by = $1,
          updated_at = NOW()
      FROM next_job
      WHERE j.id = next_job.id
      RETURNING j.id, j.pdf_id, j.job_type, j.attempts, j.max_attempts;
    `;

    const res = await this.pool.query(query, [this.workerId]);
    return res.rows.length > 0 ? res.rows[0] : null;
  }

  /**
   * Extracts pages/slides/sections from a local file via officeParser.
   */
  async extractDocumentPages(filePath, originalFilename = "") {
    const pages = [];
    const ext = path.extname(originalFilename || filePath).toLowerCase();
    const isPdf = ext === ".pdf";
    const isPptx = ext === ".pptx";

    try {
      const ast = await officeParser.parseOffice(filePath);
      if (ast && Array.isArray(ast.content) && ast.content.length > 0) {
        ast.content.forEach((node, idx) => {
          const text = String(node.text || "").trim();
          if (text) {
            if (isPdf) {
              const pageNum = Number(node.metadata?.pageNumber) || (idx + 1);
              pages.push({ pageNumber: pageNum, text });
            } else if (isPptx) {
              const slideNum = Number(node.metadata?.slideNumber) || (idx + 1);
              pages.push({ slideNumber: slideNum, text });
            } else {
              pages.push({ sectionNumber: idx + 1, text });
            }
          }
        });
      }

      if (pages.length === 0 && ast) {
        const parsedText = await ast.to("text");
        const fallbackText = String(parsedText?.value || "").trim();
        if (fallbackText) {
          pages.push({ text: fallbackText });
        }
      }
    } catch (err) {
      console.warn(`[JobProcessor] Error in officeParser extraction for ${originalFilename}:`, err.message);
    }

    return pages;
  }

  /**
   * Processes a single claimed job to completion.
   */
  async executeJob(job) {
    const { id: jobId, pdf_id: pdfId, attempts, max_attempts } = job;
    let tempFile = null;

    try {
      console.log(`[JobProcessor] Worker ${this.workerId} executing job #${jobId} (PDF #${pdfId}, attempt ${attempts}/${max_attempts})`);
      await this.updateProgress(jobId, pdfId, 10, "processing");

      // 1. Fetch document record
      const pdfRes = await this.pool.query(
        `SELECT id, original_filename, file_url, storage_path, storage_provider, classroom_id
         FROM pdfs WHERE id = $1`,
        [pdfId]
      );
      if (pdfRes.rows.length === 0) {
        throw new Error(`Document #${pdfId} does not exist in database.`);
      }
      const pdf = pdfRes.rows[0];
      const storageKey = pdf.storage_path || pdf.file_url;

      // 2. Download from cloud storage to temporary scratch file
      await this.updateProgress(jobId, pdfId, 25, "processing");
      tempFile = await cloudStorage.downloadToTemp(storageKey);

      // 3. Extract text and page structure
      await this.updateProgress(jobId, pdfId, 45, "processing");
      const pages = await this.extractDocumentPages(tempFile, pdf.original_filename);
      const pageCount = pages.length > 0 ? pages.length : 1;

      // 4. Generate structured page-aware chunks
      await this.updateProgress(jobId, pdfId, 60, "processing");
      const chunks = createChunks(pages.length > 0 ? pages : (pdf.original_filename || "Document"));
      const safeChunks = chunks.length > 0 ? chunks : [{ id: 0, text: pdf.original_filename || "Document", pageNumber: 1 }];

      // 5. Generate 768-dim embeddings via Gemini
      await this.updateProgress(jobId, pdfId, 75, "processing");
      console.log(`[JobProcessor] Generating embeddings for ${safeChunks.length} chunks of PDF #${pdfId}...`);
      const embeddings = await batchGenerateEmbeddings(safeChunks);

      // 6. Persist chunks and embeddings into pdf_chunks (idempotent: delete existing chunks first)
      await this.pool.query("DELETE FROM pdf_chunks WHERE pdf_id = $1", [pdfId]);

      // Check if embedding column is vector or array
      const colCheck = await this.pool.query(`
        SELECT udt_name 
        FROM information_schema.columns 
        WHERE table_name = 'pdf_chunks' AND column_name = 'embedding'
      `);
      const isVectorType = colCheck.rows.length > 0 && colCheck.rows[0].udt_name === "vector";

      for (let i = 0; i < safeChunks.length; i++) {
        const chunk = safeChunks[i];
        const emb = embeddings[i] || new Array(768).fill(0);
        const pageStart = chunk.pageNumber || chunk.slideNumber || chunk.sectionNumber || 1;
        const pageEnd = pageStart;
        const metadata = JSON.stringify({
          pageNumber: chunk.pageNumber,
          slideNumber: chunk.slideNumber,
          sectionNumber: chunk.sectionNumber,
          chunkLength: chunk.text.length
        });

        if (isVectorType) {
          await this.pool.query(
            `INSERT INTO pdf_chunks (pdf_id, chunk_index, page_start, page_end, content, metadata, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7::vector)`,
            [pdfId, i, pageStart, pageEnd, chunk.text, metadata, formatVectorLiteral(emb)]
          );
        } else {
          // Double precision array fallback for local dev
          await this.pool.query(
            `INSERT INTO pdf_chunks (pdf_id, chunk_index, page_start, page_end, content, metadata, embedding)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [pdfId, i, pageStart, pageEnd, chunk.text, metadata, emb]
          );
        }
      }

      // 7. Update PDF page count and mark completed
      await this.updateProgress(jobId, pdfId, 95, "processing");
      await this.pool.query(
        `UPDATE pdfs 
         SET page_count = $1, processing_status = 'completed', processing_error = NULL, updated_at = NOW() 
         WHERE id = $2`,
        [pageCount, pdfId]
      );

      // 8. Mark job completed
      await this.updateProgress(jobId, pdfId, 100, "completed");
      console.log(`\x1b[32m✔ [JobProcessor] Job #${jobId} completed successfully for PDF #${pdfId} (${safeChunks.length} chunks embedded)!\x1b[0m`);

      // Analytics
      try {
        await this.pool.query(
          `INSERT INTO analytics_events (event_name, entity_type, entity_id, metadata)
           VALUES ('document_processed', 'pdfs', $1, $2)`,
          [pdfId, JSON.stringify({ chunksCount: safeChunks.length, pageCount, jobId })]
        );
      } catch (_) {}

    } catch (err) {
      console.error(`\x1b[31m✖ [JobProcessor] Job #${jobId} failed:\x1b[0m`, err.message);
      if (attempts >= max_attempts) {
        await this.updateProgress(jobId, pdfId, 0, "failed", err.message);
      } else {
        // Unlock job for retry
        await this.pool.query(
          `UPDATE document_jobs 
           SET status = 'pending', locked_at = NULL, locked_by = NULL, error_message = $1, updated_at = NOW() 
           WHERE id = $2`,
          [`Attempt ${attempts} failed: ${err.message}`, jobId]
        );
      }
      throw err;
    } finally {
      // Safe cleanup of temporary download
      if (tempFile && fs.existsSync(tempFile)) {
        try {
          fs.unlinkSync(tempFile);
        } catch (_) {}
      }
    }
  }

  /**
   * Claims and processes a single pending job.
   */
  async processOne() {
    const job = await this.claimNextJob();
    if (!job) return false;
    try {
      await this.executeJob(job);
      return true;
    } catch (_) {
      return false;
    }
  }

  /**
   * Processes up to limit jobs in batch, respecting a maximum execution time budget.
   * Crucial for serverless environments (Vercel) to avoid timing out mid-job.
   */
  async processBatch(limit = 3, timeBudgetMs = 8000) {
    const startTime = Date.now();
    let processed = 0;

    // First, recover any stale locks from previous interrupted executions
    const recovered = await this.recoverStaleLocks(5);

    for (let i = 0; i < limit; i++) {
      // Check remaining execution time budget before claiming another job
      const elapsed = Date.now() - startTime;
      if (elapsed >= timeBudgetMs) {
        console.log(`[JobProcessor] Reached time budget (${elapsed}ms >= ${timeBudgetMs}ms). Halting batch.`);
        break;
      }

      const hasJob = await this.processOne();
      if (!hasJob) break;
      processed++;
    }

    return {
      processed,
      recovered,
      elapsedMs: Date.now() - startTime
    };
  }

  /**
   * Starts periodic polling worker for persistent server deployments.
   */
  startWorker(intervalMs = 4000) {
    if (this.isPolling) return;
    this.isPolling = true;
    console.log(`[JobProcessor] Background queue worker started (polling every ${intervalMs}ms)`);

    const poll = async () => {
      if (!this.isPolling) return;
      try {
        await this.processOne();
      } catch (err) {
        console.warn("[JobProcessor] Worker poll error:", err.message);
      } finally {
        if (this.isPolling) {
          this.pollTimer = setTimeout(poll, intervalMs);
        }
      }
    };

    this.pollTimer = setTimeout(poll, 1000);
  }

  stopWorker() {
    this.isPolling = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }
}

module.exports = JobProcessor;
