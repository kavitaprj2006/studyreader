/**
 * StudyReader Listen — Central Text-to-Speech Orchestration & Caching Service
 * 
 * Manages neural voice synthesis, audio caching in Supabase/PostgreSQL,
 * voice discovery, and fallback resilience across multi-providers.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const os = require("os");

const CloudflareTTSAdapter = require("./adapters/cloudflare-tts-adapter");
const GoogleCloudTTSAdapter = require("./adapters/google-tts-adapter");
const textNormalizer = require("./text-normalizer");

class TTSService {
  constructor(pool, cloudStorage = null) {
    this.pool = pool;
    this.cloudStorage = cloudStorage;

    this.adapters = {
      cloudflare: new CloudflareTTSAdapter(),
      google: new GoogleCloudTTSAdapter()
    };

    // Telemetry counters
    this.telemetry = {
      totalRequests: 0,
      cacheHits: 0,
      cacheMisses: 0,
      failedRequests: 0,
      totalLatencyMs: 0
    };
  }

  /**
   * Computes a deterministic cache key hash for an audio chunk.
   */
  computeChunkHash(rawText, voiceId, speed = 1.0) {
    return crypto
      .createHash("sha256")
      .update(`${rawText.trim()}_${voiceId}_${Number(speed).toFixed(2)}`)
      .digest("hex");
  }

  /**
   * Returns list of all available voices across configured adapters,
   * plus standard client-side browser synthesis options.
   */
  async getAvailableVoices() {
    const voices = [];

    // 1. Cloudflare Workers AI Neural Voices
    if (this.adapters.cloudflare.isConfigured()) {
      voices.push(...this.adapters.cloudflare.getVoices());
    }

    // 2. Google Cloud TTS Voices if configured
    if (this.adapters.google.isConfigured()) {
      voices.push(...this.adapters.google.getVoices());
    }

    // 3. Built-in Client Browser Neural Voices (always available on client device)
    voices.push(
      {
        id: "browser:en-IN-Neerja",
        name: "Microsoft Neerja (Neural — Indian English)",
        gender: "female",
        language: "en-IN",
        type: "browser",
        description: "Built-in device neural voice"
      },
      {
        id: "browser:en-IN-Prabhat",
        name: "Microsoft Prabhat (Neural — Indian English)",
        gender: "male",
        language: "en-IN",
        type: "browser",
        description: "Built-in device neural voice"
      },
      {
        id: "browser:hi-IN-Swara",
        name: "Microsoft Swara (Neural — Hindi)",
        gender: "female",
        language: "hi-IN",
        type: "browser",
        description: "Built-in device neural voice"
      },
      {
        id: "browser:en-US-Jenny",
        name: "Microsoft Jenny (Neural — US English)",
        gender: "female",
        language: "en-US",
        type: "browser",
        description: "Built-in device neural voice"
      }
    );

    return voices;
  }

  /**
   * Checks database cache for an existing audio chunk.
   */
  async getCachedAudio(chunkHash, voiceId, speed = 1.0) {
    if (!this.pool) return null;

    try {
      const res = await this.pool.query(
        `SELECT id, storage_path, duration_seconds, file_size_bytes, mime_type
         FROM audio_chunks_cache
         WHERE chunk_hash = $1 AND voice_id = $2 AND speed = $3
         LIMIT 1`,
        [chunkHash, voiceId, speed]
      );

      if (res.rows.length === 0) return null;

      const record = res.rows[0];

      // If cloud storage is available, download or read cached file
      if (this.cloudStorage && record.storage_path) {
        try {
          const tempPath = await this.cloudStorage.downloadToTemp(record.storage_path);
          const audioBuffer = fs.readFileSync(tempPath);
          try { fs.unlinkSync(tempPath); } catch (_) {}

          return {
            audioBuffer,
            contentType: record.mime_type || "audio/mpeg",
            durationSeconds: record.duration_seconds,
            cacheHit: true
          };
        } catch (downloadErr) {
          console.warn("[TTSService] Failed to retrieve cached audio from cloud storage:", downloadErr.message);
          return null;
        }
      }

      return null;
    } catch (err) {
      console.warn("[TTSService] Cache lookup error:", err.message);
      return null;
    }
  }

  /**
   * Persists synthesized audio into Supabase Storage and PostgreSQL cache.
   */
  async cacheAudio({ pdfId, pageNumber, chunkIndex, chunkHash, voiceId, speed, audioBuffer, durationSeconds }) {
    if (!this.pool || !audioBuffer) return;

    try {
      let storagePath = `audio/${pdfId}/${chunkHash}.mp3`;

      // Upload to private Supabase bucket if configured
      if (this.cloudStorage) {
        const tempLocalPath = path.join(os.tmpdir(), `sr-audio-${chunkHash}.mp3`);
        fs.writeFileSync(tempLocalPath, audioBuffer);
        try {
          await this.cloudStorage.uploadFile(tempLocalPath, storagePath);
        } catch (uploadErr) {
          console.warn("[TTSService] Could not persist audio to Supabase Storage:", uploadErr.message);
          storagePath = `local-cached://${chunkHash}`;
        } finally {
          if (fs.existsSync(tempLocalPath)) {
            try { fs.unlinkSync(tempLocalPath); } catch (_) {}
          }
        }
      }

      // Record in PostgreSQL cache table
      await this.pool.query(
        `INSERT INTO audio_chunks_cache (pdf_id, page_number, chunk_index, chunk_hash, voice_id, speed, storage_path, duration_seconds, file_size_bytes, mime_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'audio/mpeg')
         ON CONFLICT (chunk_hash, voice_id, speed) 
         DO UPDATE SET storage_path = EXCLUDED.storage_path, file_size_bytes = EXCLUDED.file_size_bytes`,
        [
          pdfId && Number(pdfId) > 0 ? Number(pdfId) : null,
          pageNumber || 1,
          chunkIndex || 0,
          chunkHash,
          voiceId,
          speed || 1.0,
          storagePath,
          durationSeconds || null,
          audioBuffer.length
        ]
      );
    } catch (err) {
      console.warn("[TTSService] Cache save error:", err.message);
    }
  }

  /**
   * Synthesizes text chunk into neural audio with caching.
   */
  async synthesizeChunk({ pdfId, pageNumber = 1, chunkIndex = 0, text, voice = "cf:luna", speed = 1.0, userOverrides = {} }) {
    const startTime = Date.now();
    this.telemetry.totalRequests++;

    const rawText = String(text || "").trim();
    if (!rawText) {
      throw new Error("Text is required for TTS synthesis.");
    }

    // 1. Normalize text for speech (formulas, chemical terms, abbreviations)
    const normalizedSpokenText = textNormalizer.normalizeText(rawText, userOverrides);

    // 2. Check if voice is intended for client browser synthesis
    if (voice.startsWith("browser:") || voice === "default") {
      return {
        useClientSynthesis: true,
        normalizedText: normalizedSpokenText,
        voice,
        speed
      };
    }

    // 3. Compute cache hash
    const chunkHash = this.computeChunkHash(normalizedSpokenText, voice, speed);

    // 4. Check cache
    const cached = await this.getCachedAudio(chunkHash, voice, speed);
    if (cached) {
      this.telemetry.cacheHits++;
      this.telemetry.totalLatencyMs += (Date.now() - startTime);
      return {
        ...cached,
        normalizedText: normalizedSpokenText,
        chunkHash,
        cacheHit: true,
        latencyMs: Date.now() - startTime
      };
    }

    this.telemetry.cacheMisses++;

    // 5. Select appropriate active provider
    let providerAdapter = null;
    if (voice.startsWith("google:") && this.adapters.google.isConfigured()) {
      providerAdapter = this.adapters.google;
    } else if (this.adapters.cloudflare.isConfigured()) {
      providerAdapter = this.adapters.cloudflare;
    } else if (this.adapters.google.isConfigured()) {
      providerAdapter = this.adapters.google;
    }

    if (!providerAdapter) {
      // If no server neural provider is configured, explicitly instruct client synthesis
      return {
        useClientSynthesis: true,
        normalizedText: normalizedSpokenText,
        voice,
        speed,
        note: "No backend neural TTS provider configured; using client neural synthesis."
      };
    }

    try {
      const result = await providerAdapter.synthesize({
        text: normalizedSpokenText,
        voice,
        rate: speed
      });

      const latencyMs = Date.now() - startTime;
      this.telemetry.totalLatencyMs += latencyMs;

      // 6. Cache audio in background (do not block client delivery)
      this.cacheAudio({
        pdfId,
        pageNumber,
        chunkIndex,
        chunkHash,
        voiceId: voice,
        speed,
        audioBuffer: result.audioBuffer,
        durationSeconds: result.durationSeconds
      }).catch(err => console.warn("[TTSService] Background audio cache failed:", err.message));

      return {
        audioBuffer: result.audioBuffer,
        contentType: result.contentType || "audio/mpeg",
        durationSeconds: result.durationSeconds,
        normalizedText: normalizedSpokenText,
        chunkHash,
        cacheHit: false,
        latencyMs
      };

    } catch (err) {
      this.telemetry.failedRequests++;
      console.error(`[TTSService] Synthesis failed on provider '${providerAdapter.name}':`, err.message);
      throw err;
    }
  }

  /**
   * Diagnostic health check for admin monitoring.
   */
  async runDiagnosticTest(voice = "cf:luna") {
    const testText = "StudyReader Listen Neural Speech Check OK.";
    const startTime = Date.now();

    try {
      const result = await this.synthesizeChunk({
        pdfId: 0,
        pageNumber: 1,
        chunkIndex: 0,
        text: testText,
        voice,
        speed: 1.0
      });

      return {
        success: true,
        voice,
        latencyMs: Date.now() - startTime,
        audioBytes: result.audioBuffer ? result.audioBuffer.length : 0,
        useClientSynthesis: Boolean(result.useClientSynthesis)
      };
    } catch (err) {
      return {
        success: false,
        voice,
        error: err.message,
        latencyMs: Date.now() - startTime
      };
    }
  }

  /**
   * Returns telemetry metrics for Admin Dashboard.
   */
  getTelemetry() {
    const total = this.telemetry.totalRequests;
    const hitRate = total > 0 ? Math.round((this.telemetry.cacheHits / total) * 100) : 0;
    const avgLatency = total > 0 ? Math.round(this.telemetry.totalLatencyMs / total) : 0;

    return {
      totalRequests: total,
      cacheHits: this.telemetry.cacheHits,
      cacheMisses: this.telemetry.cacheMisses,
      cacheHitRatePercent: hitRate,
      failedRequests: this.telemetry.failedRequests,
      avgLatencyMs: avgLatency,
      providers: {
        cloudflare: {
          name: this.adapters.cloudflare.name,
          configured: this.adapters.cloudflare.isConfigured()
        },
        google: {
          name: this.adapters.google.name,
          configured: this.adapters.google.isConfigured()
        }
      }
    };
  }
}

module.exports = TTSService;
