/**
 * StudyReader — Cloud Storage Service (Cloudflare R2 + Firebase / Private Fallback)
 * 
 * Implements private cloud storage with:
 * - Cloudflare R2 (S3-compatible via AWS SDK v3)
 * - Firebase Storage & Local Private Bucket fallback
 * - Presigned direct-to-cloud upload URLs (PUT)
 * - Short-lived presigned download/view URLs (GET)
 * - Direct object streaming and temp downloads for background workers
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const firebaseStorage = require("./firebase-storage");

let S3Client = null;
let PutObjectCommand = null;
let GetObjectCommand = null;
let DeleteObjectCommand = null;
let HeadObjectCommand = null;
let ListObjectsV2Command = null;
let getSignedUrl = null;

try {
  const s3 = require("@aws-sdk/client-s3");
  const presigner = require("@aws-sdk/s3-request-presigner");
  S3Client = s3.S3Client;
  PutObjectCommand = s3.PutObjectCommand;
  GetObjectCommand = s3.GetObjectCommand;
  DeleteObjectCommand = s3.DeleteObjectCommand;
  HeadObjectCommand = s3.HeadObjectCommand;
  ListObjectsV2Command = s3.ListObjectsV2Command;
  getSignedUrl = presigner.getSignedUrl;
} catch (_) {
  // Graceful fallback if S3 SDK fails to load
}

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

class CloudStorageService {
  constructor() {
    this.isInitialized = false;
    this.provider = "fallback"; // "r2" | "firebase" | "fallback"
    this.s3Client = null;
    this.bucketName = process.env.R2_BUCKET_NAME || process.env.FIREBASE_STORAGE_BUCKET || "studyreader-documents";
    this.endpoint = process.env.R2_ENDPOINT || (process.env.R2_ACCOUNT_ID ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com` : null);
    this.secretSignKey = process.env.SESSION_SECRET || "studyreader-signed-url-secret-2026";
  }

  initialize() {
    if (this.isInitialized) return;

    const r2AccessKey = process.env.R2_ACCESS_KEY_ID;
    const r2SecretKey = process.env.R2_SECRET_ACCESS_KEY;

    if (S3Client && r2AccessKey && r2SecretKey && this.endpoint) {
      try {
        this.s3Client = new S3Client({
          region: "auto",
          endpoint: this.endpoint,
          credentials: {
            accessKeyId: r2AccessKey,
            secretAccessKey: r2SecretKey
          }
        });
        this.provider = "r2";
        console.log(`[CloudStorage] Connected to Cloudflare R2 (bucket: ${this.bucketName}, endpoint: ${this.endpoint})`);
      } catch (err) {
        console.warn(`[CloudStorage] Failed to initialize Cloudflare R2: ${err.message}. Falling back to Firebase/Local private storage.`);
        this.provider = "firebase";
      }
    } else {
      this.provider = "firebase";
    }

    if (this.provider === "firebase") {
      firebaseStorage.initialize();
      this.provider = firebaseStorage.useLiveFirebase ? "firebase" : "local_private";
      console.log(`[CloudStorage] Operating with storage provider: ${this.provider}`);
    }

    this.isInitialized = true;
  }

  getStorageProviderName() {
    this.initialize();
    return this.provider;
  }

  /**
   * Generates a presigned upload URL for direct client-to-storage PUT upload.
   * If R2 is active, returns direct S3 presigned PUT URL.
   * If fallback/firebase is active, returns secure backend direct-upload URL.
   */
  async getPresignedUploadUrl(storagePath, contentType = "application/pdf", expiresInMinutes = 15) {
    this.initialize();
    const cleanDest = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");

    if (this.provider === "r2" && this.s3Client && PutObjectCommand) {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: cleanDest,
        ContentType: contentType
      });
      const uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresInMinutes * 60
      });
      return {
        uploadUrl,
        method: "PUT",
        headers: { "Content-Type": contentType },
        storageProvider: "r2",
        storagePath: cleanDest
      };
    } else {
      // Fallback: Direct upload via signed internal upload token
      const expiresAt = Date.now() + expiresInMinutes * 60 * 1000;
      const signatureData = `upload:${cleanDest}:${expiresAt}`;
      const token = crypto
        .createHmac("sha256", this.secretSignKey)
        .update(signatureData)
        .digest("hex");

      return {
        uploadUrl: `/api/storage/direct-upload?path=${encodeURIComponent(cleanDest)}&expires=${expiresAt}&token=${token}`,
        method: "PUT",
        headers: { "Content-Type": contentType },
        storageProvider: this.provider,
        storagePath: cleanDest
      };
    }
  }

  /**
   * Verifies an internal direct upload token.
   */
  verifyUploadToken(storagePath, expires, token) {
    if (!storagePath || !expires || !token) return false;
    const cleanDest = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");
    const now = Date.now();
    const expiryTime = Number(expires);

    if (isNaN(expiryTime) || now > expiryTime) {
      return false;
    }

    const expectedData = `upload:${cleanDest}:${expires}`;
    const expectedToken = crypto
      .createHmac("sha256", this.secretSignKey)
      .update(expectedData)
      .digest("hex");

    if (typeof token !== "string" || token.length !== expectedToken.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(Buffer.from(token, "hex"), Buffer.from(expectedToken, "hex"));
    } catch (_) {
      return false;
    }
  }

  /**
   * Uploads a file buffer or stream directly (used for direct uploads in fallback mode).
   */
  async saveBuffer(storagePath, buffer, contentType = "application/pdf") {
    this.initialize();
    const cleanDest = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");

    if (this.provider === "r2" && this.s3Client && PutObjectCommand) {
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: cleanDest,
        Body: buffer,
        ContentType: contentType
      });
      await this.s3Client.send(command);
      const hash = crypto.createHash("md5").update(buffer).digest("hex");
      return {
        storageProvider: "r2",
        storagePath: cleanDest,
        size: buffer.length,
        mimeType: contentType,
        md5Hash: hash
      };
    } else {
      const targetPath = path.join(firebaseStorage.privateStorageDir, cleanDest);
      const targetDir = path.dirname(targetPath);
      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }
      fs.writeFileSync(targetPath, buffer);
      const hash = crypto.createHash("md5").update(buffer).digest("hex");
      const metaPath = `${targetPath}.meta.json`;
      fs.writeFileSync(
        metaPath,
        JSON.stringify(
          {
            storagePath: cleanDest,
            size: buffer.length,
            mimeType: contentType,
            md5Hash: hash,
            uploadedAt: new Date().toISOString()
          },
          null,
          2
        ),
        "utf8"
      );
      return {
        storageProvider: this.provider,
        storagePath: cleanDest,
        size: buffer.length,
        mimeType: contentType,
        md5Hash: hash
      };
    }
  }

  /**
   * Generates a short-lived presigned GET URL for authorized document reading/preview.
   */
  async getPresignedDownloadUrl(storagePath, expiresInMinutes = 15) {
    this.initialize();
    const cleanDest = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");

    if (this.provider === "r2" && this.s3Client && GetObjectCommand) {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: cleanDest
      });
      return await getSignedUrl(this.s3Client, command, {
        expiresIn: expiresInMinutes * 60
      });
    } else {
      return await firebaseStorage.getSignedUrl(cleanDest, expiresInMinutes);
    }
  }

  /**
   * Alias for getPresignedDownloadUrl to support existing route callers
   */
  async getSignedUrl(storagePath, options = 15) {
    const mins = typeof options === "number" ? options : (Number(options?.expiresInMinutes) || 15);
    return this.getPresignedDownloadUrl(storagePath, mins);
  }

  /**
   * Verifies signed token for internal secure download gateway
   */
  verifySignedToken(storagePath, expires, token) {
    return firebaseStorage.verifySignedToken(storagePath, expires, token);
  }

  /**
   * Uploads a local file to storage.
   */
  async uploadFile(localFilePath, destinationPath, metadata = {}) {
    this.initialize();
    const cleanDest = destinationPath.replace(/\\/g, "/").replace(/^\/+/, "");
    const stats = fs.statSync(localFilePath);
    const md5Hash = await computeMd5(localFilePath);
    const mimeType = getMimeType(localFilePath);

    if (this.provider === "r2" && this.s3Client && PutObjectCommand) {
      const fileStream = fs.createReadStream(localFilePath);
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: cleanDest,
        Body: fileStream,
        ContentType: mimeType,
        Metadata: {
          md5hash: md5Hash,
          originalName: metadata.originalName || path.basename(localFilePath)
        }
      });
      await this.s3Client.send(command);
      return {
        storageProvider: "r2",
        storagePath: cleanDest,
        size: stats.size,
        mimeType,
        md5Hash
      };
    } else {
      return await firebaseStorage.uploadFile(localFilePath, destinationPath, metadata);
    }
  }

  /**
   * Checks if an object exists in storage.
   */
  async fileExists(storagePath) {
    this.initialize();
    const cleanDest = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");

    if (this.provider === "r2" && this.s3Client && HeadObjectCommand) {
      try {
        await this.s3Client.send(
          new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: cleanDest
          })
        );
        return true;
      } catch (err) {
        if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) {
          return false;
        }
        throw err;
      }
    } else {
      return await firebaseStorage.fileExists(cleanDest);
    }
  }

  /**
   * Retrieves head/metadata of an object.
   */
  async headObject(storagePath) {
    this.initialize();
    const cleanDest = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");

    if (this.provider === "r2" && this.s3Client && HeadObjectCommand) {
      try {
        const res = await this.s3Client.send(
          new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: cleanDest
          })
        );
        return {
          exists: true,
          size: res.ContentLength || 0,
          mimeType: res.ContentType || "application/octet-stream",
          lastModified: res.LastModified
        };
      } catch (err) {
        return { exists: false, size: 0 };
      }
    } else {
      const exists = await firebaseStorage.fileExists(cleanDest);
      if (!exists) return { exists: false, size: 0 };
      const targetPath = path.join(firebaseStorage.privateStorageDir, cleanDest);
      if (fs.existsSync(targetPath)) {
        const stats = fs.statSync(targetPath);
        return {
          exists: true,
          size: stats.size,
          mimeType: getMimeType(cleanDest),
          lastModified: stats.mtime
        };
      }
      return { exists: true, size: 0, mimeType: getMimeType(cleanDest) };
    }
  }

  /**
   * Returns a readable stream of the object.
   */
  getFileStream(storagePath) {
    this.initialize();
    const cleanDest = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");

    if (this.provider === "r2" && this.s3Client && GetObjectCommand) {
      const { PassThrough } = require("stream");
      const passThrough = new PassThrough();
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: cleanDest
      });
      this.s3Client.send(command)
        .then((response) => {
          response.Body.pipe(passThrough);
        })
        .catch((err) => {
          passThrough.destroy(err);
        });
      return passThrough;
    } else {
      return firebaseStorage.getFileStream(cleanDest);
    }
  }

  /**
   * Downloads an object to a temporary file on local disk.
   */
  async downloadToTemp(storagePath) {
    this.initialize();
    const cleanDest = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");

    if (this.provider === "r2" && this.s3Client && GetObjectCommand) {
      const ext = path.extname(cleanDest) || ".bin";
      const tempFile = path.join(os.tmpdir(), `studyreader-r2-${Date.now()}-${crypto.randomBytes(4).toString("hex")}${ext}`);
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: cleanDest
      });
      const response = await this.s3Client.send(command);
      const writeStream = fs.createWriteStream(tempFile);
      await new Promise((resolve, reject) => {
        response.Body.pipe(writeStream);
        writeStream.on("finish", resolve);
        writeStream.on("error", reject);
      });
      return tempFile;
    } else {
      return await firebaseStorage.downloadToTemp(cleanDest);
    }
  }

  /**
   * Deletes an object from cloud storage.
   */
  async deleteFile(storagePath) {
    this.initialize();
    if (!storagePath) return;
    const cleanDest = storagePath.replace(/\\/g, "/").replace(/^\/+/, "");

    if (this.provider === "r2" && this.s3Client && DeleteObjectCommand) {
      try {
        await this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: cleanDest
          })
        );
      } catch (err) {
        console.warn(`[CloudStorage] Error deleting object from R2 (${cleanDest}):`, err.message);
      }
    } else {
      await firebaseStorage.deleteFile(cleanDest);
    }
  }

  /**
   * Returns aggregated storage metrics.
   */
  async getStorageMetrics() {
    this.initialize();
    if (this.provider === "r2" && this.s3Client && ListObjectsV2Command) {
      let totalFiles = 0;
      let totalBytes = 0;
      let continuationToken = null;
      try {
        do {
          const res = await this.s3Client.send(
            new ListObjectsV2Command({
              Bucket: this.bucketName,
              ContinuationToken: continuationToken
            })
          );
          if (res.Contents) {
            for (const item of res.Contents) {
              totalFiles++;
              totalBytes += item.Size || 0;
            }
          }
          continuationToken = res.NextContinuationToken;
        } while (continuationToken);
        return { totalFiles, totalBytes, provider: "r2" };
      } catch (err) {
        console.warn(`[CloudStorage] Could not list R2 bucket objects:`, err.message);
        return { totalFiles: 0, totalBytes: 0, provider: "r2" };
      }
    } else {
      const metrics = await firebaseStorage.getStorageMetrics();
      return { ...metrics, provider: this.provider };
    }
  }
}

const cloudStorage = new CloudStorageService();
module.exports = cloudStorage;
