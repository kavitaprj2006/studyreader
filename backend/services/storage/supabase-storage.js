/**
 * StudyReader — Supabase Storage Provider
 * 
 * Implements private cloud object storage via Supabase Storage REST API v1:
 * - Presigned direct-to-cloud upload URLs (PUT)
 * - Short-lived signed download / viewing URLs (GET)
 * - Direct server-side upload, streaming, and temp file downloads
 * - Object existence, metadata queries, and deletion
 * - Private bucket enforcement with service-role key authorization
 * - Provider-independent interface matching CloudStorageService
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { PassThrough } = require("stream");

const MIME_MAP = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".txt": "text/plain"
};

function getMimeType(filePathOrName) {
  const ext = path.extname(filePathOrName).toLowerCase();
  return MIME_MAP[ext] || "application/octet-stream";
}

function computeMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("md5");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

class SupabaseStorageService {
  constructor() {
    this.isInitialized = false;
    this.supabaseUrl = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
    this.secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    this.bucketName = (process.env.SUPABASE_STORAGE_BUCKET || "studyreader").trim();
    this.isConfigured = Boolean(this.supabaseUrl && this.secretKey);
  }

  initialize() {
    this.supabaseUrl = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
    this.secretKey = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
    this.bucketName = (process.env.SUPABASE_STORAGE_BUCKET || "studyreader").trim();
    this.isConfigured = Boolean(this.supabaseUrl && this.secretKey);
    this.isInitialized = true;
    if (this.isConfigured) {
      console.log(`[SupabaseStorage] Initialized for bucket '${this.bucketName}' on ${this.supabaseUrl}`);
    }
  }

  getHeaders(contentType = "application/json", extraHeaders = {}) {
    const headers = {
      "apikey": this.secretKey,
      "Authorization": `Bearer ${this.secretKey}`,
      ...extraHeaders
    };
    if (contentType) headers["Content-Type"] = contentType;
    return headers;
  }

  cleanPath(storagePath) {
    return String(storagePath || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "")
      .replace(/\/{2,}/g, "/");
  }

  /**
   * Ensures the target private storage bucket exists on Supabase.
   */
  async ensureBucket() {
    this.initialize();
    if (!this.isConfigured) return;

    try {
      const getRes = await fetch(`${this.supabaseUrl}/storage/v1/bucket/${encodeURIComponent(this.bucketName)}`, {
        method: "GET",
        headers: this.getHeaders("application/json")
      });

      if (getRes.status === 404) {
        // Create bucket as private
        const createRes = await fetch(`${this.supabaseUrl}/storage/v1/bucket`, {
          method: "POST",
          headers: this.getHeaders("application/json"),
          body: JSON.stringify({
            id: this.bucketName,
            name: this.bucketName,
            public: false,
            file_size_limit: 52428800,
            allowed_mime_types: ["application/pdf"]
          })
        });
        if (createRes.ok) {
          console.log(`[SupabaseStorage] Created private storage bucket: '${this.bucketName}'`);
        } else {
          const err = await createRes.text();
          console.warn(`[SupabaseStorage] Could not create bucket '${this.bucketName}':`, err);
        }
      }
    } catch (err) {
      console.warn(`[SupabaseStorage] ensureBucket check warning:`, err.message);
    }
  }

  /**
   * Generates a signed upload URL for direct client PUT upload.
   */
  async getPresignedUploadUrl(storagePath, contentType = "application/pdf", expiresInMinutes = 15) {
    this.initialize();
    if (!this.isConfigured) {
      throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured for Supabase Storage.");
    }

    const cleanDest = this.cleanPath(storagePath);
    const endpoint = `${this.supabaseUrl}/storage/v1/object/upload/sign/${encodeURIComponent(this.bucketName)}/${cleanDest}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: this.getHeaders("application/json"),
      body: JSON.stringify({})
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Supabase createSignedUploadUrl failed (${res.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const relUrl = data.url || data.signedUrl || "";
    const uploadUrl = relUrl.startsWith("http")
      ? relUrl
      : `${this.supabaseUrl}/storage/v1${relUrl.startsWith("/") ? "" : "/"}${relUrl}`;

    return {
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": contentType },
      storageProvider: "supabase",
      storagePath: cleanDest,
      token: data.token || null
    };
  }

  /**
   * Directly uploads a binary buffer to Supabase Storage.
   */
  async saveBuffer(storagePath, buffer, contentType = "application/pdf") {
    this.initialize();
    if (!this.isConfigured) {
      throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured for Supabase Storage.");
    }

    const cleanDest = this.cleanPath(storagePath);
    const endpoint = `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucketName)}/${cleanDest}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: this.getHeaders(contentType, { "x-upsert": "true" }),
      body: buffer
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Supabase saveBuffer failed (${res.status}): ${errBody.slice(0, 200)}`);
    }

    const hash = crypto.createHash("md5").update(buffer).digest("hex");
    return {
      storageProvider: "supabase",
      storagePath: cleanDest,
      size: buffer.length,
      mimeType: contentType,
      md5Hash: hash
    };
  }

  /**
   * Generates a short-lived signed GET URL for authorized document download/preview.
   */
  async getPresignedDownloadUrl(storagePath, expiresInMinutes = 15) {
    this.initialize();
    if (!this.isConfigured) {
      throw new Error("SUPABASE_URL and SUPABASE_SECRET_KEY must be configured for Supabase Storage.");
    }

    const cleanDest = this.cleanPath(storagePath);
    const endpoint = `${this.supabaseUrl}/storage/v1/object/sign/${encodeURIComponent(this.bucketName)}/${cleanDest}`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: this.getHeaders("application/json"),
      body: JSON.stringify({ expiresIn: expiresInMinutes * 60 })
    });

    if (!res.ok) {
      const errBody = await res.text();
      throw new Error(`Supabase createSignedUrl failed (${res.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await res.json();
    const relUrl = data.signedURL || data.url || "";
    const downloadUrl = relUrl.startsWith("http")
      ? relUrl
      : `${this.supabaseUrl}/storage/v1${relUrl.startsWith("/") ? "" : "/"}${relUrl}`;

    return downloadUrl;
  }

  /**
   * Uploads a local file to Supabase Storage.
   */
  async uploadFile(localFilePath, destinationPath, metadata = {}) {
    this.initialize();
    const cleanDest = this.cleanPath(destinationPath);
    const stats = fs.statSync(localFilePath);
    const buffer = fs.readFileSync(localFilePath);
    const contentType = getMimeType(localFilePath);
    const md5Hash = await computeMd5(localFilePath);

    const saved = await this.saveBuffer(cleanDest, buffer, contentType);
    return {
      storageProvider: "supabase",
      storagePath: cleanDest,
      size: stats.size,
      mimeType: contentType,
      md5Hash
    };
  }

  /**
   * Checks whether an object exists in Supabase Storage.
   */
  async fileExists(storagePath) {
    this.initialize();
    if (!this.isConfigured) return false;

    const cleanDest = this.cleanPath(storagePath);
    const endpoint = `${this.supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(this.bucketName)}/${cleanDest}`;

    try {
      const res = await fetch(endpoint, {
        method: "HEAD",
        headers: this.getHeaders(null)
      });
      return res.ok;
    } catch (_) {
      return false;
    }
  }

  /**
   * Retrieves head/metadata of an object from Supabase Storage.
   */
  async headObject(storagePath) {
    this.initialize();
    if (!this.isConfigured) return { exists: false, size: 0 };

    const cleanDest = this.cleanPath(storagePath);
    const endpoint = `${this.supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(this.bucketName)}/${cleanDest}`;

    try {
      const res = await fetch(endpoint, {
        method: "HEAD",
        headers: this.getHeaders(null)
      });

      if (!res.ok) {
        return { exists: false, size: 0 };
      }

      const size = Number(res.headers.get("content-length")) || 0;
      const mimeType = res.headers.get("content-type") || getMimeType(cleanDest);
      const lastModified = res.headers.get("last-modified");

      return {
        exists: true,
        size,
        mimeType,
        lastModified
      };
    } catch (err) {
      return { exists: false, size: 0 };
    }
  }

  /**
   * Streams an object from Supabase Storage.
   */
  getFileStream(storagePath) {
    this.initialize();
    const cleanDest = this.cleanPath(storagePath);
    const passThrough = new PassThrough();

    if (!this.isConfigured) {
      process.nextTick(() => passThrough.destroy(new Error("Supabase Storage is not configured.")));
      return passThrough;
    }

    const endpoint = `${this.supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(this.bucketName)}/${cleanDest}`;

    fetch(endpoint, {
      method: "GET",
      headers: this.getHeaders(null)
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`Supabase getFileStream failed with status ${response.status}`);
        }
        const { Readable } = require("stream");
        const nodeStream = Readable.fromWeb(response.body);
        nodeStream.pipe(passThrough);
      })
      .catch((err) => {
        passThrough.destroy(err);
      });

    return passThrough;
  }

  /**
   * Downloads an object from Supabase Storage to a temporary file on local disk.
   */
  async downloadToTemp(storagePath) {
    this.initialize();
    if (!this.isConfigured) {
      throw new Error("Supabase Storage is not configured.");
    }

    const cleanDest = this.cleanPath(storagePath);
    const ext = path.extname(cleanDest) || ".bin";
    const tempFile = path.join(os.tmpdir(), `studyreader-supabase-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);

    const endpoint = `${this.supabaseUrl}/storage/v1/object/authenticated/${encodeURIComponent(this.bucketName)}/${cleanDest}`;

    const res = await fetch(endpoint, {
      method: "GET",
      headers: this.getHeaders(null)
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Supabase downloadToTemp failed (${res.status}): ${err.slice(0, 200)}`);
    }

    const fileStream = fs.createWriteStream(tempFile);
    const { Readable } = require("stream");
    const nodeStream = Readable.fromWeb(res.body);

    await new Promise((resolve, reject) => {
      nodeStream.pipe(fileStream);
      fileStream.on("finish", resolve);
      fileStream.on("error", reject);
      nodeStream.on("error", reject);
    });

    return tempFile;
  }

  /**
   * Deletes an object from Supabase Storage.
   */
  async deleteFile(storagePath) {
    this.initialize();
    if (!this.isConfigured || !storagePath) return;

    const cleanDest = this.cleanPath(storagePath);
    const endpoint = `${this.supabaseUrl}/storage/v1/object/${encodeURIComponent(this.bucketName)}`;

    try {
      const res = await fetch(endpoint, {
        method: "DELETE",
        headers: this.getHeaders("application/json"),
        body: JSON.stringify({ prefixes: [cleanDest] })
      });
      if (!res.ok) {
        const err = await res.text();
        console.warn(`[SupabaseStorage] Delete failed for ${cleanDest} (${res.status}):`, err);
      }
    } catch (err) {
      console.warn(`[SupabaseStorage] Delete error for ${cleanDest}:`, err.message);
    }
  }

  /**
   * Returns aggregated storage metrics from Supabase Storage.
   */
  async getStorageMetrics() {
    this.initialize();
    if (!this.isConfigured) {
      return { totalFiles: 0, totalBytes: 0, provider: "supabase" };
    }

    try {
      const endpoint = `${this.supabaseUrl}/storage/v1/object/list/${encodeURIComponent(this.bucketName)}`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers: this.getHeaders("application/json"),
        body: JSON.stringify({ prefix: "", limit: 1000 })
      });

      if (!res.ok) {
        return { totalFiles: 0, totalBytes: 0, provider: "supabase" };
      }

      const files = await res.json();
      let totalFiles = 0;
      let totalBytes = 0;

      if (Array.isArray(files)) {
        for (const f of files) {
          if (f.id && !f.id.endsWith("/")) {
            totalFiles++;
            totalBytes += f.metadata?.size || 0;
          }
        }
      }

      return { totalFiles, totalBytes, provider: "supabase" };
    } catch (err) {
      console.warn(`[SupabaseStorage] Error fetching storage metrics:`, err.message);
      return { totalFiles: 0, totalBytes: 0, provider: "supabase" };
    }
  }
}

const supabaseStorage = new SupabaseStorageService();
module.exports = supabaseStorage;
