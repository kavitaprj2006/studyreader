const path = require("path");
const crypto = require("crypto");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });

const express = require("express");
const session = require("express-session");
const pgSession = require("connect-pg-simple")(session);
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const cors = require("cors");
const multer = require("multer");
const fs = require("fs");
const os = require("os");
const officeParser = require("officeparser");
const piperTtsProvider =
  require("./services/tts/piper-tts-provider");
const ragService =
  require("./services/ai/rag-service");
const aiCacheService =
  require("./services/ai/ai-cache-service");
const aiProviderRouter =
  require("./services/ai/ai-provider-router");
const cloudStorage =
  require("./services/storage/cloud-storage");
const firebaseStorage = cloudStorage; // Backwards-compatible alias for cloudStorage (Supabase / R2 / Fallback)
const JobProcessor =
  require("./services/queue/job-processor");
const embeddingService =
  require("./services/ai/embedding-service");

const app = express();

// Trust reverse proxy (Render, Vercel, Cloudflare SSL termination)
app.set("trust proxy", 1);

const isProduction = process.env.NODE_ENV === "production";

// Configure Allowed Origins for CORS
const configuredOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean)
  : [];

if (process.env.FRONTEND_URL) {
  configuredOrigins.push(process.env.FRONTEND_URL.trim());
}

const defaultDevOrigins = [
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://127.0.0.1:3000",
  "http://localhost:3000"
];

const allowedOrigins = [...new Set([...configuredOrigins, ...defaultDevOrigins])];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    // Exact match in allowed list
    if (allowedOrigins.includes(origin)) return callback(null, true);
    try {
      const url = new URL(origin);
      // Allow any *.vercel.app preview or production deployment
      if (url.hostname.endsWith(".vercel.app")) {
        return callback(null, true);
      }
      // Allow any *.onrender.com deployment (self)
      if (url.hostname.endsWith(".onrender.com")) {
        return callback(null, true);
      }
    } catch (_) {}
    console.warn(`Blocked by CORS: ${origin}`);
    return callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials: true
}));

const PORT = process.env.PORT || 3000;

// ============================================================
// PDF UPLOAD CONFIGURATION
// ============================================================

const uploadDir = process.env.VERCEL
  ? path.join(os.tmpdir(), "studyreader-uploads")
  : path.join(__dirname, "uploads");
const uploadStagingDir =
  path.join(os.tmpdir(), "studyreader-pending-uploads");

fs.mkdirSync(uploadDir, { recursive: true });
fs.mkdirSync(uploadStagingDir, { recursive: true });
// Public unauthenticated access through /uploads is disabled for cloud security
app.use("/uploads", (req, res) => {
  return res.status(401).json({
    success: false,
    message: "Direct unauthenticated access to /uploads is disabled. Documents must be accessed through authenticated API endpoints."
  });
});

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, uploadStagingDir);
  },

  filename: function (req, file, cb) {
    const uniqueName =
      `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(file.originalname)}`;

    cb(null, uniqueName);
  }
});

const upload = multer({
  storage: storage,

  limits: {
    fileSize: 20 * 1024 * 1024
  },

  fileFilter: function (req, file, cb) {

    const allowedExtensions = [
      ".pdf",
      ".docx",
      ".pptx"
    ];

    const extension =
      path.extname(file.originalname).toLowerCase();

    if (allowedExtensions.includes(extension)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          "Only PDF, DOCX and PPTX files are allowed."
        )
      );
    }
  }
});
// ============================================================
// PostgreSQL Connection Pool (Supports Neon & Local DB)
// ============================================================

const { pool } = require("./db");

// Initialize Background Job Processor
const jobProcessor = new JobProcessor(pool);

// Analytics event logger helper
async function logAnalyticsEvent(userId, eventName, entityType = null, entityId = null, metadata = {}) {
  try {
    await pool.query(
      `INSERT INTO analytics_events (user_id, event_name, entity_type, entity_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId || null, eventName, entityType, entityId, JSON.stringify(metadata)]
    );
  } catch (_) {}
}

// ============================================================
// Middleware
// ============================================================

app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

// ============================================================
// Session
// ============================================================

app.use(
  session({
    store: new pgSession({
      pool: pool,
      tableName: "sessions",
    }),

    secret: process.env.SESSION_SECRET || "studyreader-production-session-secret-k281x",

    resave: false,

    saveUninitialized: false,

    cookie: {
      httpOnly: true,
      secure: isProduction,
      sameSite: process.env.COOKIE_SAME_SITE || "lax",
      maxAge: 1000 * 60 * 60 * 24 * 7, // 7 days
    },
  })
);

// ============================================================
// Basic Routes & Static Frontend Serving
// ============================================================

// Serve static frontend assets for local development
app.use(express.static(path.join(__dirname, "..")));
app.use("/frontend", express.static(path.join(__dirname, "../frontend")));
app.use("/pages", express.static(path.join(__dirname, "../frontend/pages")));
app.use("/components", express.static(path.join(__dirname, "../frontend/components")));
app.use("/scripts", express.static(path.join(__dirname, "../frontend/scripts")));
app.use("/styles", express.static(path.join(__dirname, "../frontend/styles")));

app.get("/", (req, res) => {
  if (req.accepts("html") && !req.xhr && !req.headers["accept"]?.includes("application/json")) {
    return res.sendFile(path.join(__dirname, "../index.html"));
  }
  res.json({
    success: true,
    message: "StudyReader backend is running.",
  });
});

app.get("/api/health", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW() AS current_time");

    res.json({
      success: true,
      server: "online",
      database: "connected",
      time: result.rows[0].current_time,
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      success: false,
      server: "online",
      database: "disconnected",
    });
  }
});

app.get("/api/session-test", (req, res) => {
  if (!req.session.visitCount) {
    req.session.visitCount = 0;
  }

  req.session.visitCount += 1;

  res.json({
    success: true,
    message: "Session is working.",
    visitCount: req.session.visitCount,
    sessionIdExists: Boolean(req.sessionID),
  });
});

// ===============================
// AUTHENTICATION — SIGNUP
// ===============================

app.post(["/api/auth/signup", "/api/auth/register"], async (req, res) => {
  try {
    const { name, email, password, role = "student" } = req.body;

    // 1. Basic validation
    if (
      typeof name !== "string" ||
      typeof email !== "string" ||
      typeof password !== "string"
    ) {
      return res.status(400).json({
        success: false,
        message: "Name, email and password are required."
      });
    }

    // 2. Normalize input
    const cleanName = name.trim();
    const cleanEmail = email.trim().toLowerCase();
    const normalizedRole = String(role || "student").trim().toLowerCase();

    // 3. Validate name
    if (cleanName.length < 2 || cleanName.length > 100) {
      return res.status(400).json({
        success: false,
        message: "Name must be between 2 and 100 characters."
      });
    }

    // 4. Validate email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailRegex.test(cleanEmail)) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid email address."
      });
    }

    // 5. Validate password
    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 8 characters long."
      });
    }

    // 6. Validate role (Public registration strictly allows only student or teacher)
    const allowedRoles = ["student", "teacher"];
    if (!allowedRoles.includes(normalizedRole)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role specified. Public registration only allows 'student' or 'teacher'."
      });
    }

    const isApproved = true;

    // 7. Check whether email already exists
    const existingUser = await pool.query(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [cleanEmail]
    );

    if (existingUser.rows.length > 0) {
      return res.status(409).json({
        success: false,
        message: "An account with this email already exists."
      });
    }

    // 8. Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // 9. Create user with role and approval status
    const result = await pool.query(
      `
      INSERT INTO users
        (name, email, password_hash, role, is_active, is_approved)
      VALUES
        ($1, $2, $3, $4, TRUE, $5)
      RETURNING
        id,
        name,
        email,
        role,
        is_approved,
        created_at
      `,
      [cleanName, cleanEmail, passwordHash, normalizedRole, isApproved]
    );

    const user = result.rows[0];

    // 10. Create authenticated session
    req.session.userId = user.id;
    req.session.userRole = user.role;

    // 11. Return safe user information
    return res.status(201).json({
      success: true,
      message: "Account created successfully.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.is_approved,
        createdAt: user.created_at
      }
    });

  } catch (error) {
    console.error("Signup error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to create account. Please try again later."
    });
  }
});

// ============================================================
// AUTHENTICATION — LOGIN
// ============================================================

app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Basic validation
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required."
      });
    }

    // 2. Normalize email
    const cleanEmail = email.trim().toLowerCase();

    // 3. Find user
    const result = await pool.query(
      `SELECT
        id,
        name,
        email,
        password_hash,
        role,
        is_active,
        is_approved
       FROM users
       WHERE email = $1
       LIMIT 1`,
      [cleanEmail]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    const user = result.rows[0];

    // 4. Check whether account is active
    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive."
      });
    }

    // 5. Check whether account is approved (for teachers)
    if (!user.is_approved) {
      return res.status(403).json({
        success: false,
        message: "Your teacher account is pending administrative approval."
      });
    }

    // 6. Verify password
    const passwordMatch = await bcrypt.compare(
      password,
      user.password_hash
    );

    if (!passwordMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password."
      });
    }

    // 7. Update last login
    await pool.query(
      `UPDATE users
       SET last_login = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [user.id]
    );

    // 8. Create authenticated session
    req.session.userId = user.id;
    req.session.userRole = user.role;

    // 9. Return safe user information
    return res.status(200).json({
      success: true,
      message: "Login successful.",
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.is_approved
      }
    });

  } catch (error) {
    console.error("Login error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to login. Please try again later."
    });
  }
});

// ============================================================
// AUTHENTICATION — CURRENT USER
// ============================================================

app.get("/api/auth/me", async (req, res) => {
  try {
    // Check whether the user has a session
    if (!req.session.userId) {
      return res.status(401).json({
        success: false,
        message: "Not authenticated."
      });
    }

    // Get the logged-in user
    const result = await pool.query(
      `SELECT
        id,
        name,
        email,
        role,
        is_active,
        is_approved,
        created_at,
        last_login
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        success: false,
        message: "User account not found."
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        success: false,
        message: "Your account is inactive."
      });
    }

    if (!user.is_approved) {
      return res.status(403).json({
        success: false,
        message: "Your account is pending administrative approval."
      });
    }

    return res.status(200).json({
      success: true,
      authenticated: true,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.is_approved,
        createdAt: user.created_at,
        lastLogin: user.last_login
      }
    });

  } catch (error) {
    console.error("Current user error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve user information."
    });
  }
});

// ============================================================
// PROTECTED TEST ROUTE
// ============================================================

app.get("/api/protected-test", requireAuth, (req, res) => {
  res.json({
    success: true,
    message: "You are authenticated.",
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role
    }
  });
});

// Change Password (Available to authenticated users, including Admins)
app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: "Current and new passwords are required." });
    }

    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: "New password must be at least 8 characters long." });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      return res.status(400).json({ success: false, message: "New password and confirmation do not match." });
    }

    if (currentPassword === newPassword) {
      return res.status(400).json({ success: false, message: "New password must be different from current password." });
    }

    // Fetch current user hash
    const userRes = await pool.query("SELECT password_hash, email FROM users WHERE id = $1", [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const { password_hash, email } = userRes.rows[0];
    const isMatch = await bcrypt.compare(currentPassword, password_hash);
    if (!isMatch) {
      return res.status(400).json({ success: false, message: "Current password is incorrect." });
    }

    // Hash new password
    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query("UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2", [newHash, userId]);

    // Audit log
    try {
      await pool.query(`
        INSERT INTO analytics_events (user_id, event_name, entity_type, entity_id, metadata)
        VALUES ($1, 'password_changed', 'user', $1, $2)
      `, [userId, JSON.stringify({ changed_by: userId, email })]);
    } catch (_) {}

    return res.status(200).json({ success: true, message: "Password updated successfully." });
  } catch (error) {
    console.error("Change password error:", error);
    return res.status(500).json({ success: false, message: "Unable to update password. Please try again." });
  }
});

// ============================================================
// ROLE-PROTECTED TEST ROUTES (FOR VERIFICATION)
// ============================================================

app.get("/api/auth/student-only", requireAuth, requireRole(["student", "admin"]), (req, res) => {
  res.json({
    success: true,
    message: "Authorized: Student space.",
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    }
  });
});

app.get("/api/auth/teacher-only", requireAuth, requireRole(["teacher", "admin"]), (req, res) => {
  res.json({
    success: true,
    message: "Authorized: Teacher workspace.",
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    }
  });
});

app.get("/api/auth/admin-only", requireAuth, requireRole(["admin"]), (req, res) => {
  res.json({
    success: true,
    message: "Authorized: Admin control center.",
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role
    }
  });
});

// ============================================================
// AUTHENTICATION — LOGOUT
// ============================================================

app.post("/api/auth/logout", (req, res) => {
  req.session.destroy((error) => {
    if (error) {
      console.error("Logout error:", error);

      return res.status(500).json({
        success: false,
        message: "Unable to logout. Please try again."
      });
    }

    res.clearCookie("connect.sid", {
      httpOnly: true,
      secure: false,
      sameSite: "lax"
    });

    return res.status(200).json({
      success: true,
      message: "Logout successful."
    });
  });
});

// ============================================================
// AUTHENTICATION & ROLE MIDDLEWARES
// ============================================================

async function requireAuth(req, res, next) {
  try {
    if (!req.session.userId) {
      return res.status(401).json({
        success: false,
        message: "Authentication required."
      });
    }

    const result = await pool.query(
      `SELECT id, name, email, role, is_active, is_approved
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [req.session.userId]
    );

    if (result.rows.length === 0) {
      req.session.destroy(() => { });

      return res.status(401).json({
        success: false,
        message: "User session is no longer valid."
      });
    }

    const user = result.rows[0];

    if (!user.is_active) {
      req.session.destroy(() => { });

      return res.status(403).json({
        success: false,
        message: "Your account is inactive."
      });
    }

    if (!user.is_approved) {
      req.session.destroy(() => { });

      return res.status(403).json({
        success: false,
        message: "Your account is pending administrative approval."
      });
    }

    req.user = user;

    next();

  } catch (error) {
    console.error("Authentication middleware error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to verify authentication."
    });
  }
}

function requireRole(allowedRoles) {
  const roles = Array.isArray(allowedRoles) ? allowedRoles : [allowedRoles];

  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `Forbidden: Access requires one of the following roles: [${roles.join(", ")}]. Your current role is '${req.user ? req.user.role : "unauthenticated"}'.`
      });
    }

    next();
  };
}

// ============================================================
// CLASSROOM CODE GENERATOR & ACCESS HELPERS
// ============================================================

function generateClassroomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function canAccessDocument(pdfId, userId, userRole) {
  if (userRole === "admin") {
    const res = await pool.query(
      "SELECT p.*, u.name as uploader_name, u.role as uploader_role FROM pdfs p JOIN users u ON p.user_id = u.id WHERE p.id = $1 LIMIT 1",
      [pdfId]
    );
    return res.rows[0] || null;
  }

  const query = `
    SELECT p.*, u.name as uploader_name, u.role as uploader_role
    FROM pdfs p
    JOIN users u ON p.user_id = u.id
    WHERE p.id = $1
      AND (
        p.user_id = $2
        OR (
          p.access_scope = 'classroom'
          AND p.classroom_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM classroom_members cm 
              WHERE cm.classroom_id = p.classroom_id AND cm.student_id = $2
            )
            OR EXISTS (
              SELECT 1 FROM classrooms c 
              WHERE c.id = p.classroom_id AND c.teacher_id = $2
            )
          )
        )
      )
    LIMIT 1
  `;
  const result = await pool.query(query, [pdfId, userId]);
  return result.rows[0] || null;
}

// pdf,docx formatchng============================================================
function getFileType(filename) {

  const extension =
    path.extname(filename).toLowerCase();

  switch (extension) {

    case ".pdf":
      return "pdf";

    case ".docx":
      return "docx";

    case ".pptx":
      return "pptx";

    default:
      return null;

  }

}

// ============================================================
// COMMON DOCUMENT EXTRACTION HELPERS
// ============================================================

function isSafeUploadFilename(filename) {
  return (
    typeof filename === "string" &&
    filename.length > 0 &&
    path.basename(filename) === filename
  );
}

function countWords(text) {
  const normalizedText =
    String(text || "").trim();

  if (!normalizedText) {
    return 0;
  }

  return normalizedText
    .split(/\s+/)
    .filter(Boolean)
    .length;
}

async function getDocumentLocalPath(document) {
  if (!document) {
    throw new Error("Document object is required.");
  }

  // 1. Check if cached locally in uploadDir
  if (document.filename && isSafeUploadFilename(document.filename)) {
    const localPath = path.resolve(uploadDir, document.filename);
    if (path.dirname(localPath) === path.resolve(uploadDir) && fs.existsSync(localPath)) {
      return { filePath: localPath, isTemp: false };
    }
  }

  // 2. Fetch from Cloud Storage (Supabase / R2 / Fallback)
  if (document.storage_path) {
    const tempPath = await cloudStorage.downloadToTemp(document.storage_path);
    return { filePath: tempPath, isTemp: true };
  }

  throw new Error(`Document file not found: ${document.original_filename || document.filename}`);
}

function moveFile(source, destination) {
  if (fs.existsSync(destination)) {
    throw new Error("A file with the generated upload name already exists.");
  }

  try {
    fs.renameSync(source, destination);
  } catch (error) {
    if (error.code !== "EXDEV") {
      throw error;
    }

    fs.copyFileSync(
      source,
      destination,
      fs.constants.COPYFILE_EXCL
    );

    try {
      fs.unlinkSync(source);
    } catch (error) {
      fs.unlinkSync(destination);
      throw error;
    }
  }
}

function getPendingUpload(req, filename) {
  if (
    typeof filename !== "string" ||
    path.basename(filename) !== filename
  ) {
    return null;
  }

  const pendingUpload =
    req.session.pendingUploads?.[filename];

  if (
    !pendingUpload ||
    pendingUpload.filename !== filename ||
    String(pendingUpload.userId) !== String(req.user.id)
  ) {
    return null;
  }

  const filePath =
    path.resolve(uploadStagingDir, filename);

  if (
    path.dirname(filePath) !==
    path.resolve(uploadStagingDir)
  ) {
    return null;
  }

  return {
    ...pendingUpload,
    filePath
  };
}

function clearPendingUpload(req, filename) {
  delete req.session.pendingUploads[filename];

  if (
    Object.keys(req.session.pendingUploads).length === 0
  ) {
    delete req.session.pendingUploads;
  }
}

// ============================================================
// PDF UPLOAD
// ============================================================

// ============================================================
// PDF UPLOAD
// Handles:
// 1. New PDF
// 2. Duplicate filename
// 3. Replace existing
// 4. Keep both
// ============================================================

app.post("/api/pdfs/upload", upload.single("pdf"), async (req, res) => {
  let finalFilePath = null;
  let fileMovedToPublicDirectory = false;
  let fileSavedInDatabase = false;

  try {
    // ----------------------------------------------------------
    // USER MUST BE LOGGED IN
    // ----------------------------------------------------------

    if (!req.session.userId) {
      if (req.file) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(401).json({
        success: false,
        message: "You must be logged in to upload a document."
      });
    }

    // ----------------------------------------------------------
    // CHECK FILE
    // ----------------------------------------------------------

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "Please select a supported file."
      });
    }

    const userId = req.session.userId;
    const originalFilename = req.file.originalname;
    const fileType =
      getFileType(
        req.file.originalname
      );

    const subjectId = req.body.subjectId || req.body.subject_id || null;
    const classroomId = req.body.classroomId || req.body.classroom_id || null;
    const category = req.body.category === "pyq" ? "pyq" : "resource";
    const academicYear = req.body.academicYear || req.body.academic_year || null;
    const semester = req.body.semester || null;
    const accessScope = classroomId ? "classroom" : "private";

    if (!fileType) {

      if (fs.existsSync(req.file.path)) {
        fs.unlinkSync(req.file.path);
      }

      return res.status(400).json({
        success: false,
        message:
          "Unsupported file format."
      });

    }
    // ----------------------------------------------------------
    // CHECK WHETHER SAME FILENAME ALREADY EXISTS
    // FOR THIS USER ONLY
    // ----------------------------------------------------------

    const existingResult = await pool.query(
      `
      SELECT
        id,
        filename,
        original_filename,
        file_url,
        file_size,
        processing_status,
        created_at
      FROM pdfs
      WHERE user_id = $1
        AND LOWER(original_filename) = LOWER($2)
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId, originalFilename]
    );

    // ----------------------------------------------------------
    // DUPLICATE FOUND
    // ----------------------------------------------------------

    if (existingResult.rows.length > 0) {
      const existingPdf = existingResult.rows[0];

      if (!req.session.pendingUploads) {
        req.session.pendingUploads = {};
      }

      req.session.pendingUploads[req.file.filename] = {
        filename: req.file.filename,
        originalFilename: req.file.originalname,
        fileSize: req.file.size,
        userId,
        subjectId,
        classroomId,
        category,
        academicYear,
        semester,
        accessScope
      };

      await new Promise((resolve, reject) => {
        req.session.save((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });

      // Keep the newly uploaded file temporarily.
      // The user will decide whether to:
      // 1. Cancel
      // 2. Keep Both
      // 3. Replace Existing

      return res.status(409).json({
        success: false,
        duplicate: true,
        message: "A document with this filename already exists.",
        pendingUpload: {
          filename: req.file.filename,
          originalFilename: req.file.originalname,
          fileSize: req.file.size
        },
        existingPdf: {
          id: existingPdf.id,
          originalFilename: existingPdf.original_filename,
          fileSize: existingPdf.file_size,
          processingStatus: existingPdf.processing_status,
          createdAt: existingPdf.created_at
        }
      });
    }
    // ----------------------------------------------------------
    // NO DUPLICATE
    // SAVE NEW PDF
    // ----------------------------------------------------------

    finalFilePath =
      path.join(uploadDir, req.file.filename);
    moveFile(req.file.path, finalFilePath);
    fileMovedToPublicDirectory = true;

    // Upload to Cloud Storage (Supabase Storage active)
    const cloudStoragePath = `documents/${userId}/${Date.now()}_${req.file.filename}`;
    const cloudUpload = await cloudStorage.uploadFile(
      finalFilePath,
      cloudStoragePath,
      {
        originalFilename,
        userId,
        classroomId,
        subjectId,
        category
      }
    );

    const insertResult = await pool.query(
      `
      INSERT INTO pdfs
        (
          user_id,
          filename,
          original_filename,
          file_url,
          file_size,
          processing_status,
          classroom_id,
          subject_id,
          category,
          academic_year,
          semester,
          access_scope,
          storage_provider,
          storage_path,
          mime_type,
          md5_hash
        )
      VALUES
        ($1, $2, $3, 'pending', $4, 'uploaded', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id
      `,
      [
        userId,
        req.file.filename,
        req.file.originalname,
        req.file.size,
        classroomId ? Number(classroomId) : null,
        subjectId ? Number(subjectId) : null,
        category,
        academicYear,
        semester,
        accessScope,
        cloudUpload.storageProvider,
        cloudUpload.storagePath,
        cloudUpload.mimeType,
        cloudUpload.md5Hash
      ]
    );

    const newDocId = insertResult.rows[0].id;
    const result = await pool.query(
      `
      UPDATE pdfs
      SET file_url = $1
      WHERE id = $2
      RETURNING
        id,
        filename,
        original_filename,
        file_url,
        file_size,
        page_count,
        processing_status,
        classroom_id,
        subject_id,
        category,
        academic_year,
        semester,
        access_scope,
        storage_provider,
        storage_path,
        created_at
      `,
      [`/api/pdfs/${newDocId}/file`, newDocId]
    );

    const pdf = result.rows[0];
    fileSavedInDatabase = true;

    // Enqueue durable background processing job
    try {
      await jobProcessor.enqueueJob(pdf.id, "process_document");
      await logAnalyticsEvent(userId, "document_uploaded", "pdfs", pdf.id, {
        filename: pdf.original_filename,
        fileSize: pdf.file_size,
        category: pdf.category
      });

      // Notify enrolled students if uploaded to a classroom
      if (classroomId) {
        notifyClassroomStudents(
          Number(classroomId),
          `New ${category === 'pyq' ? 'PYQ' : 'Material'} Available`,
          `"${pdf.original_filename}" was uploaded to your classroom materials.`,
          "material_added"
        ).catch((notifErr) => {
          console.warn("[Upload] Could not broadcast student notifications:", notifErr.message);
        });
      }

      // In serverless environments, attempt immediate processing within bounded budget
      if (process.env.VERCEL || req.query.processNow === "true") {
        try {
          await Promise.race([
            jobProcessor.processOne(),
            new Promise((resolve) => setTimeout(() => resolve(false), 8000))
          ]);
        } catch (procErr) {
          console.log("[Upload] Inline processing deferred to queue:", procErr.message);
        }
      }
    } catch (jobErr) {
      console.warn("Could not enqueue document processing job:", jobErr.message);
    }

    return res.status(201).json({
      success: true,
      duplicate: false,
      message: "Resource uploaded successfully.",
      pdf: {
        id: pdf.id,
        filename: pdf.filename,
        originalFilename: pdf.original_filename,
        fileUrl: pdf.file_url,
        fileSize: pdf.file_size,
        fileType: getFileType(pdf.original_filename || pdf.filename),
        pageCount: pdf.page_count,
        processingStatus: pdf.processing_status,
        classroomId: pdf.classroom_id,
        subjectId: pdf.subject_id,
        category: pdf.category,
        academicYear: pdf.academic_year,
        semester: pdf.semester,
        accessScope: pdf.access_scope,
        storageProvider: pdf.storage_provider,
        storagePath: pdf.storage_path,
        createdAt: pdf.created_at
      }
    });

  } catch (error) {
    console.error("PDF upload error:", error);

    // ----------------------------------------------------------
    // REMOVE UPLOADED FILE IF SOMETHING FAILED
    // ----------------------------------------------------------

    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }

    if (
      fileMovedToPublicDirectory &&
      !fileSavedInDatabase &&
      finalFilePath &&
      fs.existsSync(finalFilePath)
    ) {
      fs.unlinkSync(finalFilePath);
    }

    return res.status(500).json({
      success: false,
      message: error?.message ? `Unable to upload document: ${error.message}` : "Unable to upload document."
    });
  }
});

// ============================================================
// DUPLICATE PDF — CANCEL
// ============================================================

app.post("/api/pdfs/duplicate/cancel", requireAuth, async (req, res) => {
  try {
    const { filename } = req.body;

    if (typeof filename !== "string" || !filename) {
      return res.status(400).json({
        success: false,
        message: "Pending upload filename is required."
      });
    }

    const pendingUpload =
      getPendingUpload(req, filename);

    if (!pendingUpload) {
      return res.status(404).json({
        success: false,
        message: "Pending upload was not found."
      });
    }

    if (fs.existsSync(pendingUpload.filePath)) {
      fs.unlinkSync(pendingUpload.filePath);
    }

    clearPendingUpload(req, filename);

    return res.status(200).json({
      success: true,
      message: "Duplicate upload cancelled."
    });

  } catch (error) {
    console.error("Cancel duplicate upload error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to cancel duplicate upload."
    });
  }
});


// ============================================================
// DUPLICATE PDF — KEEP BOTH
// ============================================================

app.post("/api/pdfs/duplicate/keep-both", requireAuth, async (req, res) => {
  try {
    const { filename } = req.body;

    if (typeof filename !== "string" || !filename) {
      return res.status(400).json({
        success: false,
        message: "Pending upload information is required."
      });
    }

    const pendingUpload =
      getPendingUpload(req, filename);

    if (
      !pendingUpload ||
      !fs.existsSync(pendingUpload.filePath)
    ) {
      return res.status(404).json({
        success: false,
        message: "Pending uploaded file was not found."
      });
    }

    const userId = req.user.id;
    const publicFilePath =
      path.join(uploadDir, pendingUpload.filename);

    moveFile(
      pendingUpload.filePath,
      publicFilePath
    );

    // Upload to Cloud Storage (Supabase Storage active)
    const cloudStoragePath = `documents/${userId}/${Date.now()}_${pendingUpload.filename}`;
    const cloudUpload = await cloudStorage.uploadFile(
      publicFilePath,
      cloudStoragePath,
      {
        originalFilename: pendingUpload.originalFilename,
        userId,
        classroomId: pendingUpload.classroomId,
        subjectId: pendingUpload.subjectId,
        category: pendingUpload.category
      }
    );

    let result;

    try {
      const insertResult = await pool.query(
        `
      INSERT INTO pdfs
        (
          user_id,
          filename,
          original_filename,
          file_url,
          file_size,
          processing_status,
          classroom_id,
          subject_id,
          category,
          academic_year,
          semester,
          access_scope,
          storage_provider,
          storage_path,
          mime_type,
          md5_hash
        )
      VALUES
        ($1, $2, $3, 'pending', $4, 'uploaded', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id
      `,
        [
          userId,
          pendingUpload.filename,
          pendingUpload.originalFilename,
          pendingUpload.fileSize,
          pendingUpload.classroomId ? Number(pendingUpload.classroomId) : null,
          pendingUpload.subjectId ? Number(pendingUpload.subjectId) : null,
          pendingUpload.category || 'resource',
          pendingUpload.academicYear || null,
          pendingUpload.semester || null,
          pendingUpload.accessScope || (pendingUpload.classroomId ? 'classroom' : 'private'),
          cloudUpload.storageProvider,
          cloudUpload.storagePath,
          cloudUpload.mimeType,
          cloudUpload.md5Hash
        ]
      );

      const newDocId = insertResult.rows[0].id;
      result = await pool.query(
        `
        UPDATE pdfs
        SET file_url = $1
        WHERE id = $2
        RETURNING
          id,
          filename,
          original_filename,
          file_url,
          file_size,
          page_count,
          processing_status,
          classroom_id,
          subject_id,
          category,
          academic_year,
          semester,
          access_scope,
          storage_provider,
          storage_path,
          created_at
        `,
        [`/api/pdfs/${newDocId}/file`, newDocId]
      );
    } catch (error) {
      moveFile(
        publicFilePath,
        pendingUpload.filePath
      );
      if (cloudUpload?.storagePath) {
        try { await cloudStorage.deleteFile(cloudUpload.storagePath); } catch (_) {}
      }
      throw error;
    }

    const pdf = result.rows[0];
    clearPendingUpload(req, filename);

    // Enqueue durable background processing job
    try {
      await jobProcessor.enqueueJob(pdf.id, "process_document");
      await logAnalyticsEvent(userId, "document_uploaded", "pdfs", pdf.id, {
        filename: pdf.original_filename,
        fileSize: pdf.file_size,
        category: pdf.category
      });

      // Notify enrolled students if uploaded to a classroom
      if (classroomId) {
        notifyClassroomStudents(
          Number(classroomId),
          `New ${category === 'pyq' ? 'PYQ' : 'Material'} Available`,
          `"${pdf.original_filename}" was uploaded to your classroom materials.`,
          "material_added"
        ).catch((notifErr) => {
          console.warn("[Upload] Could not broadcast student notifications:", notifErr.message);
        });
      }

      // In serverless environments, attempt immediate processing within bounded budget
      if (process.env.VERCEL || req.query.processNow === "true") {
        try {
          await Promise.race([
            jobProcessor.processOne(),
            new Promise((resolve) => setTimeout(() => resolve(false), 8000))
          ]);
        } catch (procErr) {
          console.log("[Upload] Inline processing deferred to queue:", procErr.message);
        }
      }
    } catch (jobErr) {
      console.warn("Could not enqueue document processing job:", jobErr.message);
    }

    return res.status(201).json({
      success: true,
      message: "Both PDFs have been kept.",
      pdf: {
        id: pdf.id,
        filename: pdf.filename,
        originalFilename: pdf.original_filename,
        fileUrl: pdf.file_url,
        fileSize: pdf.file_size,
        fileType: getFileType(pdf.original_filename || pdf.filename),
        pageCount: pdf.page_count,
        processingStatus: pdf.processing_status,
        classroomId: pdf.classroom_id,
        subjectId: pdf.subject_id,
        category: pdf.category,
        storageProvider: pdf.storage_provider,
        storagePath: pdf.storage_path,
        createdAt: pdf.created_at
      }
    });

  } catch (error) {
    console.error("Keep both duplicate error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to keep both PDFs."
    });
  }
});


// ============================================================
// DUPLICATE PDF — REPLACE EXISTING
// ============================================================

app.post("/api/pdfs/duplicate/replace", requireAuth, async (req, res) => {
  try {
    const {
      filename,
      existingPdfId
    } = req.body;

    if (
      typeof filename !== "string" ||
      !filename ||
      !existingPdfId
    ) {
      return res.status(400).json({
        success: false,
        message: "Replacement information is required."
      });
    }

    const pendingUpload =
      getPendingUpload(req, filename);

    if (
      !pendingUpload ||
      !fs.existsSync(pendingUpload.filePath)
    ) {
      return res.status(404).json({
        success: false,
        message: "Pending uploaded file was not found."
      });
    }

    const userId = req.user.id;

    // Verify that the existing PDF belongs to this user.
    const existingResult = await pool.query(
      `
      SELECT filename, storage_path
      FROM pdfs
      WHERE id = $1
        AND user_id = $2
      LIMIT 1
      `,
      [existingPdfId, userId]
    );

    if (existingResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Existing PDF was not found."
      });
    }

    const oldFilename = existingResult.rows[0].filename;
    const oldStoragePath = existingResult.rows[0].storage_path;
    const oldFilePath = path.join(uploadDir, oldFilename);

    const publicFilePath =
      path.join(uploadDir, pendingUpload.filename);

    moveFile(
      pendingUpload.filePath,
      publicFilePath
    );

    // Upload new file to Cloud Storage (Supabase Storage active)
    const cloudStoragePath = `documents/${userId}/${Date.now()}_${pendingUpload.filename}`;
    const cloudUpload = await cloudStorage.uploadFile(
      publicFilePath,
      cloudStoragePath,
      {
        originalFilename: pendingUpload.originalFilename,
        userId,
        classroomId: pendingUpload.classroomId,
        subjectId: pendingUpload.subjectId,
        category: pendingUpload.category
      }
    );

    let result;

    try {
      result = await pool.query(
        `
      UPDATE pdfs
      SET
        filename = $1,
        original_filename = $2,
        file_url = $3,
        file_size = $4,
        processing_status = 'uploaded',
        classroom_id = $5,
        subject_id = $6,
        category = $7,
        academic_year = $8,
        semester = $9,
        access_scope = $10,
        storage_provider = $11,
        storage_path = $12,
        mime_type = $13,
        md5_hash = $14,
        page_count = NULL,
        processing_error = NULL
      WHERE id = $15
        AND user_id = $16
      RETURNING
        id,
        filename,
        original_filename,
        file_url,
        file_size,
        page_count,
        processing_status,
        classroom_id,
        subject_id,
        category,
        academic_year,
        semester,
        access_scope,
        storage_provider,
        storage_path,
        created_at
      `,
        [
          pendingUpload.filename,
          pendingUpload.originalFilename,
          `/api/pdfs/${existingPdfId}/file`,
          pendingUpload.fileSize,
          pendingUpload.classroomId ? Number(pendingUpload.classroomId) : null,
          pendingUpload.subjectId ? Number(pendingUpload.subjectId) : null,
          pendingUpload.category || 'resource',
          pendingUpload.academicYear || null,
          pendingUpload.semester || null,
          pendingUpload.accessScope || (pendingUpload.classroomId ? 'classroom' : 'private'),
          cloudUpload.storageProvider,
          cloudUpload.storagePath,
          cloudUpload.mimeType,
          cloudUpload.md5Hash,
          existingPdfId,
          userId
        ]
      );
    } catch (error) {
      moveFile(
        publicFilePath,
        pendingUpload.filePath
      );
      if (cloudUpload?.storagePath) {
        try { await cloudStorage.deleteFile(cloudUpload.storagePath); } catch (_) {}
      }
      throw error;
    }

    // Delete old cloud storage object if one existed
    if (oldStoragePath) {
      try {
        await cloudStorage.deleteFile(oldStoragePath);
      } catch (cloudErr) {
        console.warn("Could not remove replaced cloud storage object:", cloudErr.message);
      }
    }

    // Delete old physical file after database replacement.
    if (
      oldFilename &&
      oldFilename !== pendingUpload.filename &&
      fs.existsSync(oldFilePath)
    ) {
      try {
        fs.unlinkSync(oldFilePath);
      } catch (error) {
        console.error("Could not remove replaced PDF file:", error);
      }
    }

    const pdf = result.rows[0];
    clearPendingUpload(req, filename);

    // Enqueue durable background processing job for replaced document
    try {
      await jobProcessor.enqueueJob(pdf.id, "process_document");
      await logAnalyticsEvent(userId, "document_replaced", "pdfs", pdf.id, {
        filename: pdf.original_filename,
        fileSize: pdf.file_size
      });
    } catch (jobErr) {
      console.warn("Could not enqueue document processing job:", jobErr.message);
    }

    return res.status(200).json({
      success: true,
      message: "Existing PDF replaced successfully.",
      pdf: {
        id: pdf.id,
        filename: pdf.filename,
        originalFilename: pdf.original_filename,
        fileUrl: pdf.file_url,
        fileSize: pdf.file_size,
        fileType: getFileType(pdf.original_filename || pdf.filename),
        pageCount: pdf.page_count,
        processingStatus: pdf.processing_status,
        classroomId: pdf.classroom_id,
        subjectId: pdf.subject_id,
        category: pdf.category,
        storageProvider: pdf.storage_provider,
        storagePath: pdf.storage_path,
        createdAt: pdf.created_at
      }
    });

  } catch (error) {
    console.error("Replace duplicate error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to replace existing PDF."
    });
  }
});

// ============================================================
// GET USER PDFs (PERSONAL & ENROLLED CLASSROOM MATERIALS)
// ============================================================

app.get("/api/pdfs", requireAuth, async (req, res) => {
  try {
    const { subjectId, classroomId, category } = req.query;
    let query = `
      SELECT
        p.id,
        p.user_id,
        p.filename,
        p.original_filename,
        p.file_url,
        p.file_size,
        p.page_count,
        p.processing_status,
        p.category,
        p.academic_year,
        p.semester,
        p.classroom_id,
        p.subject_id,
        p.access_scope,
        p.created_at,
        u.name as uploader_name,
        u.role as uploader_role,
        s.name as subject_name,
        c.name as classroom_name
      FROM pdfs p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN subjects s ON p.subject_id = s.id
      LEFT JOIN classrooms c ON p.classroom_id = c.id
      WHERE (
        p.user_id = $1
        OR (
          p.access_scope = 'classroom'
          AND p.classroom_id IS NOT NULL
          AND (
            EXISTS (
              SELECT 1 FROM classroom_members cm 
              WHERE cm.classroom_id = p.classroom_id AND cm.student_id = $1
            )
            OR EXISTS (
              SELECT 1 FROM classrooms cl 
              WHERE cl.id = p.classroom_id AND cl.teacher_id = $1
            )
          )
        )
      )
    `;
    const params = [req.user.id];

    if (subjectId) {
      params.push(Number(subjectId));
      query += ` AND p.subject_id = $${params.length}`;
    }
    if (classroomId) {
      params.push(Number(classroomId));
      query += ` AND p.classroom_id = $${params.length}`;
    }
    if (category) {
      params.push(category);
      query += ` AND p.category = $${params.length}`;
    }

    query += ` ORDER BY p.created_at DESC`;

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      pdfs: result.rows.map((pdf) => ({
        id: pdf.id,
        filename: pdf.filename,
        originalFilename: pdf.original_filename,
        fileUrl: pdf.file_url,
        fileSize: pdf.file_size,
        fileType: getFileType(pdf.original_filename || pdf.filename),
        pageCount: pdf.page_count,
        processingStatus: pdf.processing_status,
        category: pdf.category || "resource",
        academicYear: pdf.academic_year,
        semester: pdf.semester,
        classroomId: pdf.classroom_id ? Number(pdf.classroom_id) : null,
        classroomName: pdf.classroom_name,
        subjectId: pdf.subject_id ? Number(pdf.subject_id) : null,
        subjectName: pdf.subject_name,
        accessScope: pdf.access_scope,
        uploadedBy: {
          name: pdf.uploader_name,
          role: pdf.uploader_role,
          isMe: String(pdf.user_id) === String(req.user.id)
        },
        createdAt: pdf.created_at
      }))
    });

  } catch (error) {
    console.error("Get PDFs error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to retrieve PDFs."
    });
  }
});

// ============================================================
// SIGNED SHORT-LIVED URL SECURE DOWNLOAD GATEWAY
// (Must be defined before /api/pdfs/:id for Express routing precedence)
// ============================================================

app.get("/api/pdfs/secure-download", async (req, res) => {
  try {
    const { token, path: storagePath, expires } = req.query;

    if (!token || !storagePath || !expires) {
      return res.status(400).json({
        success: false,
        message: "Download token, expiry, and storage path are required."
      });
    }

    const isValid = cloudStorage.verifySignedToken(storagePath, expires, token);
    if (!isValid) {
      return res.status(403).json({
        success: false,
        message: "Invalid or expired download token."
      });
    }

    const exists = await cloudStorage.fileExists(storagePath);
    if (!exists) {
      return res.status(404).json({
        success: false,
        message: "File not found in storage bucket."
      });
    }

    const filename = path.basename(storagePath);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.setHeader("Content-Type", "application/octet-stream");

    const stream = cloudStorage.getFileStream(storagePath);
    return stream.pipe(res);

  } catch (error) {
    console.error("Secure download error:", error);
    return res.status(500).json({
      success: false,
      message: "Secure download failed."
    });
  }
});

// ============================================================
// GET SINGLE PDF BY ID
// ============================================================

app.get("/api/pdfs/:id", requireAuth, async (req, res) => {
  try {
    const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found or access denied."
      });
    }

    let classroomName = null;
    let subjectName = null;

    if (document.classroom_id) {
      const cRes = await pool.query("SELECT name FROM classrooms WHERE id = $1", [document.classroom_id]);
      if (cRes.rows.length) classroomName = cRes.rows[0].name;
    }
    if (document.subject_id) {
      const sRes = await pool.query("SELECT name FROM subjects WHERE id = $1", [document.subject_id]);
      if (sRes.rows.length) subjectName = sRes.rows[0].name;
    }

    return res.status(200).json({
      success: true,
      pdf: {
        id: document.id,
        filename: document.filename,
        originalFilename: document.original_filename,
        fileUrl: document.file_url,
        fileSize: document.file_size,
        fileType: getFileType(document.original_filename || document.filename),
        pageCount: document.page_count,
        overview: document.overview,
        processingStatus: document.processing_status,
        category: document.category || "resource",
        academicYear: document.academic_year,
        semester: document.semester,
        classroomId: document.classroom_id ? Number(document.classroom_id) : null,
        classroomName: classroomName,
        subjectId: document.subject_id ? Number(document.subject_id) : null,
        subjectName: subjectName,
        accessScope: document.access_scope,
        storageProvider: document.storage_provider,
        storagePath: document.storage_path,
        uploadedBy: {
          name: document.uploader_name,
          role: document.uploader_role,
          isMe: String(document.user_id) === String(req.user.id)
        },
        createdAt: document.created_at
      }
    });
  } catch (error) {
    console.error("Get PDF by ID error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve document details."
    });
  }
});

// ============================================================
// AUTHENTICATED DOCUMENT FILE STREAMING & DOWNLOAD
// ============================================================

app.get("/api/pdfs/:id/file", requireAuth, async (req, res) => {
  try {
    const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found or access denied."
      });
    }

    const mimeType = document.mime_type || (
      document.original_filename?.endsWith(".pdf") || document.filename?.endsWith(".pdf")
        ? "application/pdf"
        : document.original_filename?.endsWith(".docx") || document.filename?.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : document.original_filename?.endsWith(".pptx") || document.filename?.endsWith(".pptx")
        ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
        : "application/octet-stream"
    );

    const safeOriginalName = (document.original_filename || document.filename || "document.pdf")
      .replace(/["\r\n]/g, "");

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(safeOriginalName)}"`);
    res.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");

    if (document.file_size) {
      res.setHeader("Content-Length", document.file_size);
    }

    // 1. Try Cloud Storage stream if storage_path is recorded
    if (document.storage_path) {
      const existsInCloud = await cloudStorage.fileExists(document.storage_path);
      if (existsInCloud) {
        const stream = cloudStorage.getFileStream(document.storage_path);
        stream.on("error", (err) => {
          console.error("Cloud storage stream error:", err);
          if (!res.headersSent) {
            res.status(500).json({ success: false, message: "Error streaming document from cloud storage." });
          }
        });
        return stream.pipe(res);
      }
    }

    // 2. Fallback to local uploadDir if file is stored locally
    if (document.filename) {
      const localPath = path.resolve(uploadDir, document.filename);
      if (isSafeUploadFilename(document.filename) &&
          path.dirname(localPath) === path.resolve(uploadDir) &&
          fs.existsSync(localPath)) {
        return fs.createReadStream(localPath).pipe(res);
      }
    }

    return res.status(404).json({
      success: false,
      message: "Physical document file was not found in cloud or local storage."
    });

  } catch (error) {
    console.error("Document stream error:", error);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        message: "Failed to stream document."
      });
    }
  }
});

// ============================================================
// SIGNED SHORT-LIVED URL & SECURE DOWNLOAD GATEWAY
// ============================================================

app.get("/api/pdfs/:id/signed-url", requireAuth, async (req, res) => {
  try {
    const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found or access denied."
      });
    }

    const storagePath = document.storage_path || `documents/${document.user_id}/${document.filename}`;
    const signedUrl = await cloudStorage.getSignedUrl(storagePath, {
      expiresInMinutes: 15,
      filename: document.original_filename || document.filename
    });

    return res.status(200).json({
      success: true,
      documentId: document.id,
      originalFilename: document.original_filename || document.filename,
      signedUrl,
      expiresInMinutes: 15
    });

  } catch (error) {
    console.error("Generate signed URL error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to generate signed URL."
    });
  }
});

// ============================================================
// CLOUD STORAGE & DIRECT UPLOAD API (Cloudflare R2 & Fallback)
// ============================================================

// 1. Request Presigned Upload URL (Client-to-Storage direct upload)
app.post("/api/storage/presigned-upload", requireAuth, async (req, res) => {
  try {
    const { filename, contentType = "application/pdf", classroomId, subjectId, category = "resource", academicYear, semester } = req.body;

    if (!filename || typeof filename !== "string") {
      return res.status(400).json({ success: false, message: "Filename is required." });
    }

    const ext = path.extname(filename).toLowerCase();
    if (![".pdf", ".docx", ".pptx"].includes(ext)) {
      return res.status(400).json({ success: false, message: "Only PDF, DOCX, and PPTX files are permitted." });
    }

    if (classroomId) {
      if (req.user.role === "teacher") {
        const check = await pool.query(
          "SELECT id FROM classrooms WHERE id = $1 AND teacher_id = $2 AND is_archived = FALSE",
          [classroomId, req.user.id]
        );
        if (check.rows.length === 0) {
          return res.status(403).json({ success: false, message: "You are not authorized to upload to this classroom." });
        }
      } else if (req.user.role === "student") {
        const check = await pool.query(
          "SELECT 1 FROM classroom_members WHERE classroom_id = $1 AND student_id = $2",
          [classroomId, req.user.id]
        );
        if (check.rows.length === 0) {
          return res.status(403).json({ success: false, message: "You are not enrolled in this classroom." });
        }
      }
    }

    const sanitizedBase = path.basename(filename).replace(/[^a-zA-Z0-9._-]/g, "_");
    const uniqueFilename = `${Date.now()}_${sanitizedBase}`;
    const storagePath = `documents/${req.user.id}/${uniqueFilename}`;

    const accessScope = classroomId ? "classroom" : "private";

    const insertRes = await pool.query(
      `INSERT INTO pdfs (
         user_id, filename, original_filename, file_url, file_size,
         processing_status, classroom_id, subject_id, category,
         academic_year, semester, storage_provider, storage_path, mime_type, access_scope
       ) VALUES ($1, $2, $3, $4, 0, 'uploaded', $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING id, filename, original_filename, storage_path`,
      [
        req.user.id,
        uniqueFilename,
        filename,
        storagePath,
        classroomId ? Number(classroomId) : null,
        subjectId ? Number(subjectId) : null,
        category,
        academicYear || null,
        semester || null,
        cloudStorage.getStorageProviderName(),
        storagePath,
        contentType,
        accessScope
      ]
    );

    const pdfRecord = insertRes.rows[0];
    const presigned = await cloudStorage.getPresignedUploadUrl(storagePath, contentType, 15);

    return res.status(200).json({
      success: true,
      pdfId: pdfRecord.id,
      storagePath,
      uploadUrl: presigned.uploadUrl,
      method: presigned.method,
      headers: presigned.headers,
      storageProvider: presigned.storageProvider
    });
  } catch (error) {
    console.error("Presigned upload generation error:", error);
    return res.status(500).json({ success: false, message: "Unable to generate upload URL." });
  }
});

// 2. Direct binary upload endpoint for local/fallback storage mode
app.put("/api/storage/direct-upload", express.raw({ type: "*/*", limit: "60mb" }), async (req, res) => {
  try {
    const { path: storagePath, expires, token } = req.query;
    if (!storagePath || !expires || !token) {
      return res.status(400).json({ success: false, message: "Missing upload token or path parameters." });
    }

    const isValid = cloudStorage.verifyUploadToken(storagePath, expires, token);
    if (!isValid) {
      return res.status(403).json({ success: false, message: "Invalid or expired upload token." });
    }

    if (!req.body || req.body.length === 0) {
      return res.status(400).json({ success: false, message: "Uploaded body is empty." });
    }

    const contentType = req.headers["content-type"] || "application/pdf";
    const result = await cloudStorage.saveBuffer(storagePath, req.body, contentType);

    return res.status(200).json({
      success: true,
      message: "Direct upload received successfully.",
      storagePath: result.storagePath,
      size: result.size
    });
  } catch (err) {
    console.error("Direct upload error:", err);
    return res.status(500).json({ success: false, message: "Direct upload failed." });
  }
});

// 3. Finalize upload & enqueue background processing job
app.post("/api/storage/finalize-upload", requireAuth, async (req, res) => {
  try {
    const { pdfId, storagePath } = req.body;
    if (!pdfId) {
      return res.status(400).json({ success: false, message: "pdfId is required." });
    }

    const pdfCheck = await pool.query(
      "SELECT id, storage_path, user_id FROM pdfs WHERE id = $1",
      [pdfId]
    );
    if (pdfCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Document not found." });
    }

    const pdf = pdfCheck.rows[0];
    if (String(pdf.user_id) !== String(req.user.id) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }

    const effectivePath = storagePath || pdf.storage_path;
    const head = await cloudStorage.headObject(effectivePath);
    if (!head.exists) {
      return res.status(400).json({ success: false, message: "Uploaded object not found in cloud storage." });
    }

    await pool.query(
      "UPDATE pdfs SET file_size = $1, processing_status = 'uploaded', updated_at = NOW() WHERE id = $2",
      [head.size, pdfId]
    );

    const job = await jobProcessor.enqueueJob(pdfId, "process_document");

    // In serverless environments (or when requested), attempt immediate processing within bounded budget
    if (req.query.processNow === "true" || process.env.VERCEL) {
      try {
        await Promise.race([
          jobProcessor.processOne(),
          new Promise((resolve) => setTimeout(() => resolve(false), 7000))
        ]);
      } catch (procErr) {
        console.log("[Finalize] Inline processing deferred to queue:", procErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      message: "Document upload finalized and enqueued for processing.",
      pdfId,
      jobId: job.id,
      fileSize: head.size
    });
  } catch (err) {
    console.error("Finalize upload error:", err);
    return res.status(500).json({ success: false, message: "Unable to finalize upload." });
  }
});

// ============================================================
// DURABLE BACKGROUND JOB QUEUE API
// ============================================================

app.post("/api/jobs/process-batch", async (req, res) => {
  try {
    const cronSecret = process.env.CRON_SECRET || process.env.JOB_SECRET;
    const authHeader = req.headers.authorization;
    const headerSecret = req.headers["x-cron-secret"];
    const isCronAuthorized = cronSecret && (
      authHeader === `Bearer ${cronSecret}` || 
      headerSecret === cronSecret
    );
    const isUserAuthorized = req.session && req.session.userId;

    if (!isCronAuthorized && !isUserAuthorized) {
      return res.status(401).json({ success: false, message: "Unauthorized job trigger." });
    }

    const limit = Math.min(Math.max(Number(req.query.limit) || 2, 1), 5);
    const timeBudgetMs = Math.min(Math.max(Number(req.query.timeBudgetMs) || 8000, 2000), 55000);
    const result = await jobProcessor.processBatch(limit, timeBudgetMs);

    return res.status(200).json({
      success: true,
      processedCount: result.processed,
      recoveredCount: result.recovered,
      elapsedMs: result.elapsedMs,
      message: `Processed ${result.processed} job(s), recovered ${result.recovered} stale lock(s).`
    });
  } catch (err) {
    console.error("Process batch error:", err);
    return res.status(500).json({ success: false, message: err.message });
  }
});

app.get("/api/jobs/:id", requireAuth, async (req, res) => {
  try {
    const jobRes = await pool.query(
      `SELECT j.*, p.original_filename, p.user_id as doc_owner_id
       FROM document_jobs j
       JOIN pdfs p ON j.pdf_id = p.id
       WHERE j.id = $1`,
      [req.params.id]
    );

    if (jobRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Job not found." });
    }

    const job = jobRes.rows[0];
    if (String(job.doc_owner_id) !== String(req.user.id) && req.user.role !== "admin") {
      return res.status(403).json({ success: false, message: "Unauthorized." });
    }

    return res.status(200).json({
      success: true,
      job: {
        id: job.id,
        pdfId: job.pdf_id,
        filename: job.original_filename,
        status: job.status,
        progress: job.progress,
        attempts: job.attempts,
        errorMessage: job.error_message,
        createdAt: job.created_at,
        updatedAt: job.updated_at
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Error fetching job status." });
  }
});

app.get("/api/pdfs/:id/job-status", requireAuth, async (req, res) => {
  try {
    const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
    if (!document) {
      return res.status(404).json({ success: false, message: "Document not found or access denied." });
    }

    const jobRes = await pool.query(
      `SELECT id, status, progress, attempts, error_message, updated_at
       FROM document_jobs
       WHERE pdf_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [req.params.id]
    );

    return res.status(200).json({
      success: true,
      pdfId: Number(req.params.id),
      processingStatus: document.processing_status,
      job: jobRes.rows.length > 0 ? jobRes.rows[0] : null
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: "Error checking document job status." });
  }
});

// ============================================================
// CLASSROOM MEMBERSHIP LIFECYCLE & HARDENING
// ============================================================

app.delete("/api/classrooms/:id/members/:studentId", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const classroomId = req.params.id;
    const studentId = req.params.studentId;

    if (req.user.role !== "admin") {
      const classCheck = await pool.query(
        "SELECT id FROM classrooms WHERE id = $1 AND teacher_id = $2 AND is_archived = FALSE",
        [classroomId, req.user.id]
      );
      if (classCheck.rows.length === 0) {
        return res.status(403).json({ success: false, message: "You are not authorized to manage this classroom." });
      }
    }

    const delRes = await pool.query(
      "DELETE FROM classroom_members WHERE classroom_id = $1 AND student_id = $2 RETURNING id",
      [classroomId, studentId]
    );

    if (delRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "Student is not enrolled in this classroom." });
    }

    await logAnalyticsEvent(req.user.id, "classroom_member_removed", "classroom_members", delRes.rows[0].id, {
      classroomId,
      studentId
    });

    return res.status(200).json({
      success: true,
      message: "Student removed from classroom successfully."
    });
  } catch (err) {
    console.error("Remove classroom member error:", err);
    return res.status(500).json({ success: false, message: "Failed to remove student." });
  }
});

app.post("/api/classrooms/:id/renew-code", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const classroomId = req.params.id;

    if (req.user.role !== "admin") {
      const classCheck = await pool.query(
        "SELECT id FROM classrooms WHERE id = $1 AND teacher_id = $2 AND is_archived = FALSE",
        [classroomId, req.user.id]
      );
      if (classCheck.rows.length === 0) {
        return res.status(403).json({ success: false, message: "You are not authorized to manage this classroom." });
      }
    }

    let newCode;
    let isUnique = false;
    for (let attempts = 0; attempts < 5; attempts++) {
      newCode = crypto.randomBytes(3).toString("hex").toUpperCase();
      const check = await pool.query("SELECT id FROM classrooms WHERE code = $1", [newCode]);
      if (check.rows.length === 0) {
        isUnique = true;
        break;
      }
    }

    if (!isUnique) {
      return res.status(500).json({ success: false, message: "Failed to generate unique classroom code." });
    }

    await pool.query(
      "UPDATE classrooms SET code = $1, updated_at = NOW() WHERE id = $2",
      [newCode, classroomId]
    );

    await logAnalyticsEvent(req.user.id, "classroom_code_renewed", "classrooms", classroomId, { newCode });

    return res.status(200).json({
      success: true,
      message: "Classroom join code renewed successfully.",
      code: newCode
    });
  } catch (err) {
    console.error("Renew code error:", err);
    return res.status(500).json({ success: false, message: "Failed to renew code." });
  }
});

app.post("/api/classrooms/:id/leave", requireAuth, async (req, res) => {
  try {
    const classroomId = req.params.id;

    const classCheck = await pool.query("SELECT teacher_id FROM classrooms WHERE id = $1", [classroomId]);
    if (classCheck.rows.length > 0 && String(classCheck.rows[0].teacher_id) === String(req.user.id)) {
      return res.status(400).json({ success: false, message: "Teachers cannot leave a classroom they own." });
    }

    const delRes = await pool.query(
      "DELETE FROM classroom_members WHERE classroom_id = $1 AND student_id = $2 RETURNING id",
      [classroomId, req.user.id]
    );

    if (delRes.rows.length === 0) {
      return res.status(404).json({ success: false, message: "You are not a member of this classroom." });
    }

    await logAnalyticsEvent(req.user.id, "classroom_left", "classrooms", classroomId, { studentId: req.user.id });

    return res.status(200).json({
      success: true,
      message: "You have left the classroom."
    });
  } catch (err) {
    console.error("Leave classroom error:", err);
    return res.status(500).json({ success: false, message: "Failed to leave classroom." });
  }
});

// ============================================================
// CROSS-DOCUMENT CLASSROOM SEMANTIC SEARCH (pgvector + Gemini)
// ============================================================

app.get("/api/classrooms/:id/semantic-search", requireAuth, async (req, res) => {
  try {
    const classroomId = req.params.id;
    const queryText = (req.query.q || "").trim();

    if (!queryText) {
      return res.status(400).json({ success: false, message: "Search query 'q' is required." });
    }

    const isTeacher = await pool.query(
      "SELECT 1 FROM classrooms WHERE id = $1 AND teacher_id = $2 AND is_archived = FALSE",
      [classroomId, req.user.id]
    );
    const isEnrolled = await pool.query(
      "SELECT 1 FROM classroom_members WHERE classroom_id = $1 AND student_id = $2",
      [classroomId, req.user.id]
    );
    const isAdmin = req.user.role === "admin";

    if (isTeacher.rows.length === 0 && isEnrolled.rows.length === 0 && !isAdmin) {
      return res.status(403).json({ success: false, message: "Access denied to this classroom." });
    }

    const queryEmb = await embeddingService.generateEmbedding(queryText);
    const typeCheck = await pool.query("SELECT 1 FROM pg_type WHERE typname = 'vector'");
    const hasVectorType = typeCheck.rows.length > 0;

    let results = [];
    if (hasVectorType) {
      const vectorRes = await pool.query(
        `SELECT c.id, c.pdf_id, c.chunk_index, c.page_start, c.page_end, c.content, c.metadata,
                p.original_filename, p.category,
                (c.embedding <=> $1::vector) as distance
         FROM pdf_chunks c
         JOIN pdfs p ON c.pdf_id = p.id
         WHERE p.classroom_id = $2 AND p.is_archived = FALSE
         ORDER BY c.embedding <=> $1::vector ASC
         LIMIT 10`,
        [embeddingService.formatVectorLiteral(queryEmb), classroomId]
      );
      results = vectorRes.rows.map(r => ({
        id: r.id,
        pdfId: r.pdf_id,
        documentTitle: r.original_filename,
        category: r.category,
        pageNumber: r.page_start,
        content: r.content,
        metadata: r.metadata,
        similarity: Number((1 - (r.distance || 0)).toFixed(4))
      }));
    } else {
      const chunksRes = await pool.query(
        `SELECT c.id, c.pdf_id, c.chunk_index, c.page_start, c.page_end, c.content, c.metadata, c.embedding,
                p.original_filename, p.category
         FROM pdf_chunks c
         JOIN pdfs p ON c.pdf_id = p.id
         WHERE p.classroom_id = $1 AND p.is_archived = FALSE
         LIMIT 100`,
        [classroomId]
      );
      results = chunksRes.rows
        .map(r => ({
          id: r.id,
          pdfId: r.pdf_id,
          documentTitle: r.original_filename,
          category: r.category,
          pageNumber: r.page_start,
          content: r.content,
          metadata: r.metadata,
          similarity: Number(embeddingService.cosineSimilarity(queryEmb, r.embedding).toFixed(4))
        }))
        .filter(r => r.similarity > 0.3)
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, 10);
    }

    await logAnalyticsEvent(req.user.id, "semantic_search", "classrooms", classroomId, {
      query: queryText,
      resultCount: results.length
    });

    return res.status(200).json({
      success: true,
      query: queryText,
      count: results.length,
      results
    });
  } catch (err) {
    console.error("Semantic search error:", err);
    return res.status(500).json({ success: false, message: "Semantic search failed." });
  }
});

async function extractDocumentPages(filePath, originalFilename = "") {
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
    console.warn("Could not extract pages via officeParser:", err.message);
  }

  return pages;
}

// ============================================================
// CONVERSATIONAL CHAT ENGINE (PERSISTENT & GROUNDED)
// ============================================================

app.get("/api/pdfs/:id/chat", requireAuth, async (req, res) => {
  try {
    const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found or access denied."
      });
    }

    const result = await pool.query(
      `SELECT id, role, message, created_at as "createdAt"
       FROM chat_messages
       WHERE user_id = $1 AND pdf_id = $2
       ORDER BY created_at ASC`,
      [req.user.id, req.params.id]
    );

    return res.status(200).json({
      success: true,
      messages: result.rows
    });
  } catch (error) {
    console.error("Get chat messages error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve chat messages."
    });
  }
});

app.post("/api/pdfs/:id/chat", requireAuth, async (req, res) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message content is required."
      });
    }

    const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found or access denied."
      });
    }

    // 1. Save student's user message
    const userMsgResult = await pool.query(
      `INSERT INTO chat_messages (user_id, pdf_id, role, message)
       VALUES ($1, $2, 'user', $3)
       RETURNING id, role, message, created_at as "createdAt"`,
      [req.user.id, req.params.id, message]
    );
    const userMsg = userMsgResult.rows[0];

    // 2. Fetch past conversation turns for grounding
    const historyResult = await pool.query(
      `SELECT role, message
       FROM chat_messages
       WHERE user_id = $1 AND pdf_id = $2
       ORDER BY created_at DESC
       LIMIT 8`,
      [req.user.id, req.params.id]
    );
    const history = historyResult.rows.reverse();

    // 3. Check for vector embeddings in pdf_chunks (Hybrid RAG)
    let selectedChunks = null;
    try {
      const chunkCountRes = await pool.query(
        "SELECT COUNT(*)::int as count FROM pdf_chunks WHERE pdf_id = $1",
        [document.id]
      );
      if (chunkCountRes.rows[0].count > 0) {
        const queryEmb = await embeddingService.generateEmbedding(message);
        const typeCheck = await pool.query("SELECT 1 FROM pg_type WHERE typname = 'vector'");
        if (typeCheck.rows.length > 0) {
          const vectorRes = await pool.query(
            `SELECT chunk_index, page_start, content, metadata
             FROM pdf_chunks
             WHERE pdf_id = $1
             ORDER BY embedding <=> $2::vector ASC
             LIMIT 6`,
            [document.id, embeddingService.formatVectorLiteral(queryEmb)]
          );
          selectedChunks = vectorRes.rows.map(r => ({
            id: r.chunk_index,
            pageNumber: r.page_start,
            text: r.content
          }));
        } else {
          const allChunks = await pool.query(
            "SELECT chunk_index, page_start, content, embedding FROM pdf_chunks WHERE pdf_id = $1",
            [document.id]
          );
          const scored = allChunks.rows.map(r => ({
            id: r.chunk_index,
            pageNumber: r.page_start,
            text: r.content,
            score: embeddingService.cosineSimilarity(queryEmb, r.embedding)
          })).sort((a, b) => b.score - a.score);
          selectedChunks = scored.slice(0, 6);
        }
      }
    } catch (embErr) {
      console.warn("Vector search failed, falling back to document extraction:", embErr.message);
    }

    let pages = [];
    if (!selectedChunks || selectedChunks.length === 0) {
      try {
        const { filePath, isTemp } = await getDocumentLocalPath(document);
        try {
          pages = await extractDocumentPages(filePath, document.original_filename || document.filename);
        } finally {
          if (isTemp && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (_) {}
          }
        }
      } catch (e) {
        console.warn("Could not load document pages for chat:", e.message);
      }
      if (!pages || pages.length === 0) {
        pages = [{
          text: `Document: ${document.original_filename}\nCategory: ${document.category || "Study Resource"}\nAcademic Year: ${document.academic_year || "Current Semester"}`
        }];
      }
    }

    // 4. Check persistent answer cache or generate with AI router
    const contentHash = document.file_hash || document.checksum || `doc-${document.id}`;
    const chunkIds = (selectedChunks || []).map(c => c.id || c.pageNumber).join("-");
    const contextFingerprint = aiCacheService.hashString(chunkIds || "full-doc");

    let cachedAnswer = null;
    if (!history || history.length <= 1) {
      cachedAnswer = await aiCacheService.getCachedAnswer({
        documentId: document.id,
        question: message,
        contextFingerprint,
        contentHash
      });
    }

    let assistantAnswer = "";
    let aiProvider = "gemini";
    let aiModel = "gemini-3.5-flash-lite";
    let aiSources = [];
    let isCached = false;

    if (cachedAnswer) {
      assistantAnswer = cachedAnswer.text;
      aiProvider = cachedAnswer.provider;
      aiModel = cachedAnswer.model;
      aiSources = cachedAnswer.sources || [];
      isCached = true;
    } else {
      const aiResult = await ragService.answer({
        mode: "ask-ai",
        question: message,
        pages,
        selectedChunks,
        history
      });

      assistantAnswer = aiResult.answer || "I reviewed the document, but could not produce a specific response.";
      aiProvider = aiResult.provider || "gemini";
      aiModel = aiResult.model || "gemini";
      aiSources = aiResult.sources || [];

      if (!history || history.length <= 1) {
        aiCacheService.setCachedAnswer({
          documentId: document.id,
          question: message,
          contextFingerprint,
          contentHash,
          answerText: assistantAnswer,
          sources: aiSources,
          model: aiModel,
          provider: aiProvider
        }).catch(() => {});
      }
    }

    // 5. Persist assistant message
    const botMsgResult = await pool.query(
      `INSERT INTO chat_messages (user_id, pdf_id, role, message)
       VALUES ($1, $2, 'assistant', $3)
       RETURNING id, role, message, created_at as "createdAt"`,
      [req.user.id, req.params.id, assistantAnswer]
    );
    const botMsg = botMsgResult.rows[0];

    return res.status(200).json({
      success: true,
      userMessage: userMsg,
      assistantMessage: botMsg,
      sources: aiSources,
      provider: aiProvider,
      model: aiModel,
      cached: isCached
    });

  } catch (error) {
    console.error("Chat generation error:", error);
    return res.status(502).json({
      success: false,
      message: error.message || "Unable to generate study answer."
    });
  }
});

app.delete("/api/pdfs/:id/chat", requireAuth, async (req, res) => {
  try {
    const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found or access denied."
      });
    }

    await pool.query(
      `DELETE FROM chat_messages WHERE user_id = $1 AND pdf_id = $2`,
      [req.user.id, req.params.id]
    );

    return res.status(200).json({
      success: true,
      message: "Chat thread cleared successfully."
    });
  } catch (error) {
    console.error("Clear chat error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to clear chat thread."
    });
  }
});

app.get("/api/pdfs/:id/text", requireAuth, async (req, res) => {
  try {
    const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);

    if (!document) {
      return res.status(404).json({
        success: false,
        message: "Document not found or access denied."
      });
    }

    const fileType =
      getFileType(
        document.original_filename || document.filename
      );

    if (fileType !== "pdf" && fileType !== "docx" && fileType !== "pptx") {
      return res.status(415).json({
        success: false,
        message: "This document format is not supported for text extraction."
      });
    }

    let parsedText;
    const { filePath, isTemp } = await getDocumentLocalPath(document);

    try {
      const ast =
        await officeParser.parseOffice(filePath);

      parsedText =
        await ast.to("text");

      if (typeof parsedText.value !== "string") {
        throw new Error("Office document parser returned invalid text.");
      }
    } finally {
      if (isTemp && fs.existsSync(filePath)) {
        try { fs.unlinkSync(filePath); } catch (_) {}
      }
    }

    return res.status(200).json({
      success: true,
      text: parsedText.value
    });
  } catch (error) {
    console.error("Office document text extraction error:", error);

    return res.status(500).json({
      success: false,
      message: "Unable to extract text from this document."
    });
  }
});

// ============================================================
// COMMON PDF, DOCX AND PPTX TEXT EXTRACTION
// ============================================================

app.get(
  "/api/pdfs/:id/extracted-text",
  requireAuth,
  async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found or access denied."
        });
      }

      if (!isSafeUploadFilename(document.filename)) {
        console.error(
          "Unsafe stored upload filename:",
          document.filename
        );

        return res.status(500).json({
          success: false,
          message: "The stored document path is invalid."
        });
      }

      const fileType =
        getFileType(
          document.original_filename ||
          document.filename
        );

      if (
        fileType !== "pdf" &&
        fileType !== "docx" &&
        fileType !== "pptx"
      ) {
        return res.status(415).json({
          success: false,
          message: "This document format is not supported."
        });
      }

      let text = "";
      const { filePath, isTemp } = await getDocumentLocalPath(document);

      try {
        const ast =
          await officeParser.parseOffice(filePath);

        const parsedText =
          await ast.to("text");

        if (
          !parsedText ||
          typeof parsedText.value !== "string"
        ) {
          throw new Error(
            "Document parser returned invalid text."
          );
        }

        text = parsedText.value.trim();
      } finally {
        if (isTemp && fs.existsSync(filePath)) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      }

      return res.status(200).json({
        success: true,
        document: {
          id: document.id,
          filename: document.filename,
          originalFilename: document.original_filename,
          fileType,
          fileSize: document.file_size
        },
        content: {
          text,
          characterCount: text.length,
          wordCount: countWords(text)
        }
      });

    } catch (error) {
      console.error(
        "Common document text extraction error:",
        error
      );

      return res.status(500).json({
        success: false,
        message: "Unable to extract text from this document."
      });
    }
  }
);

// ============================================================
// NEURAL READ ALOUD AUDIO
// ============================================================

app.get(
  "/api/tts/voices",
  requireAuth,
  (req, res) => {
    try {
      return res.status(200).json({
        success: true,
        voices: piperTtsProvider.getVoices()
      });
    } catch (error) {
      console.error("Piper voice configuration error:", error);

      return res.status(503).json({
        success: false,
        message: error.message
      });
    }
  }
);

app.post(
  "/api/pdfs/:id/tts",
  requireAuth,
  async (req, res) => {
    try {
      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found or access denied."
        });
      }

      const {
        text,
        voiceName,
        language,
        rate
      } = req.body || {};

      const result =
        await piperTtsProvider.synthesize({
          text,
          voiceName,
          language,
          rate
        });

      if (result.useClientSynthesis || !result.audio) {
        return res.status(200).json({
          success: true,
          useClientSynthesis: true,
          message: "Use browser neural speech synthesis."
        });
      }

      res.set("Content-Type", result.contentType || "audio/wav");
      res.set("Cache-Control", "private, max-age=3600");

      return res.status(200).send(result.audio);
    } catch (error) {
      console.error(
        "Neural text-to-speech error:",
        error
      );

      return res.status(502).json({
        success: false,
        message:
          error.message ||
          "Unable to generate local reading audio."
      });
    }
  }
);

// ============================================================
// DOCUMENT-GROUNDED AI (RAG)
// ============================================================

app.post(
  "/api/pdfs/:id/ai",
  requireAuth,
  async (req, res) => {
    try {
      const mode =
        String(req.body?.mode || "").toLowerCase();
      const question =
        String(req.body?.question || "").trim();
      const summaryType =
        String(req.body?.summaryType || "").toLowerCase();
      const highlightedText =
        String(req.body?.highlightedText || "").trim();

      const allowedModes = [
        "overview",
        "summary",
        "explanation",
        "ask-ai"
      ];

      if (!allowedModes.includes(mode)) {
        return res.status(400).json({
          success: false,
          message: "Unsupported AI mode."
        });
      }

      if (mode === "ask-ai" && !question) {
        return res.status(400).json({
          success: false,
          message: "A question is required for Ask AI."
        });
      }

      let effectiveQuestion = question;
      if (mode === "summary") {
        if (summaryType === "quick") {
          effectiveQuestion = "Provide an executive 3-bullet concise summary highlighting only the highest-impact key concepts.";
        } else if (summaryType === "takeaways") {
          effectiveQuestion = "Provide a high-yield exam cheat sheet: key formulas, core definitions, and top examination takeaways.";
        } else if (summaryType === "detailed") {
          effectiveQuestion = "Provide a comprehensive, in-depth academic study breakdown across all sections of this document.";
        }
      } else if (mode === "explanation" && highlightedText) {
        effectiveQuestion = `Explain this specific highlighted excerpt from the document in clear, friendly pedagogical terms with an intuitive real-world analogy: "${highlightedText}"`;
      }

      const document = await canAccessDocument(req.params.id, req.user.id, req.user.role);

      if (!document) {
        return res.status(404).json({
          success: false,
          message: "Document not found or access denied."
        });
      }

      // Check persistent summary cache
      const contentHash = document.file_hash || document.checksum || `doc-${document.id}`;
      if (mode === "summary" || mode === "overview") {
        const cachedSummary = await aiCacheService.getCachedSummary({
          documentId: document.id,
          summaryType: summaryType || "quick",
          contentHash
        });

        if (cachedSummary) {
          return res.status(200).json({
            success: true,
            document: {
              id: req.params.id,
              originalFilename: document.original_filename
            },
            answer: cachedSummary.text,
            sources: cachedSummary.sources,
            mode,
            provider: cachedSummary.provider,
            model: cachedSummary.model,
            cached: true,
            hitCount: cachedSummary.hitCount
          });
        }
      }

      let pages = [];
      try {
        const { filePath, isTemp } = await getDocumentLocalPath(document);
        try {
          pages = await extractDocumentPages(filePath, document.original_filename || document.filename);
        } finally {
          if (isTemp && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (_) {}
          }
        }
      } catch (err) {
        console.warn("Could not retrieve document for AI processing:", err.message);
      }

      if (!pages || pages.length === 0) {
        pages = [{
          text: `Document: ${document.original_filename}\nCategory: ${document.category || "Study Resource"}\nAcademic Year: ${document.academic_year || "Current Semester"}`
        }];
      }

      const result = await ragService.answer({
        mode,
        question: effectiveQuestion,
        pages,
        summaryType,
        documentId: req.params.id
      });

      if ((mode === "summary" || mode === "overview") && result.answer) {
        aiCacheService.setCachedSummary({
          documentId: document.id,
          summaryType: summaryType || "quick",
          contentHash,
          summaryText: result.answer,
          sources: result.sources,
          model: result.model || "gemini",
          provider: result.provider || "gemini"
        }).catch(() => {});
      }

      return res.status(200).json({
        success: true,
        document: {
          id: req.params.id,
          originalFilename: document.original_filename
        },
        ...result
      });
    } catch (error) {
      console.error("Document AI error:", error);

      return res.status(502).json({
        success: false,
        message:
          error.message ||
          "Unable to generate a document-grounded answer."
      });
    }
  }
);

// ============================================================
// DELETE PDF
// ============================================================

app.delete("/api/pdfs/:id", requireAuth, async (req, res) => {
  try {
    const pdfId = req.params.id;
    const userId = req.user.id;

    const document = await canAccessDocument(pdfId, userId, req.user.role);
    if (!document) {
      return res.status(404).json({
        success: false,
        message: "PDF not found."
      });
    }

    const isUploader = String(document.user_id) === String(userId);
    const isAdmin = req.user.role === "admin";
    let isClassroomTeacher = false;
    if (document.classroom_id) {
      const cRes = await pool.query(
        "SELECT 1 FROM classrooms WHERE id = $1 AND teacher_id = $2",
        [document.classroom_id, userId]
      );
      isClassroomTeacher = cRes.rows.length > 0;
    }

    if (!isUploader && !isAdmin && !isClassroomTeacher) {
      return res.status(403).json({
        success: false,
        message: "You do not have permission to delete this document."
      });
    }

    const filename = document.filename;
    const storagePath = document.storage_path;

    await pool.query(
      `DELETE FROM pdfs WHERE id = $1`,
      [pdfId]
    );

    // Delete from Cloud Storage (Supabase / R2)
    if (storagePath) {
      try {
        await cloudStorage.deleteFile(storagePath);
      } catch (cloudErr) {
        console.warn("Could not delete cloud storage object:", cloudErr.message);
      }
    }

    if (filename) {
      const filePath = path.join(uploadDir, filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.warn("Could not delete physical file:", e.message);
        }
      }
    }

    await aiCacheService.invalidateDocumentCache(pdfId);

    return res.status(200).json({
      success: true,
      message: "Resource deleted successfully."
    });

  } catch (error) {
    console.error("Delete PDF error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete PDF."
    });
  }
});

// ============================================================
// CLASSROOMS MANAGEMENT
// ============================================================

// 1. Create a Classroom (Teacher or Admin)
app.post("/api/classrooms", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const { name, semester, section, description } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Classroom name is required."
      });
    }

    // Generate unique 6-character code
    let joinCode;
    let codeExists = true;
    for (let attempts = 0; attempts < 10 && codeExists; attempts++) {
      joinCode = generateClassroomCode();
      const existing = await pool.query("SELECT 1 FROM classrooms WHERE code = $1", [joinCode]);
      if (existing.rows.length === 0) {
        codeExists = false;
      }
    }

    if (codeExists) {
      return res.status(500).json({
        success: false,
        message: "Unable to generate unique classroom code. Please try again."
      });
    }

    const result = await pool.query(
      `INSERT INTO classrooms (name, code, teacher_id, semester, section, description)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, code, teacher_id, semester, section, description, created_at`,
      [
        name.trim(),
        joinCode,
        req.user.id,
        semester ? String(semester).trim() : null,
        section ? String(section).trim() : null,
        description ? String(description).trim() : null
      ]
    );

    const classroom = result.rows[0];

    return res.status(201).json({
      success: true,
      message: "Classroom created successfully.",
      classroom: {
        id: classroom.id,
        name: classroom.name,
        code: classroom.code,
        semester: classroom.semester,
        section: classroom.section,
        description: classroom.description,
        createdAt: classroom.created_at
      }
    });

  } catch (error) {
    console.error("Create classroom error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create classroom."
    });
  }
});

// 1b. Update / Rename Classroom (Teacher or Admin)
const handleUpdateClassroom = async (req, res) => {
  try {
    const classroomId = req.params.id;
    const { name, semester, section, description } = req.body;

    const classCheck = await pool.query(
      "SELECT id, teacher_id, name, is_archived FROM classrooms WHERE id = $1",
      [classroomId]
    );

    if (classCheck.rows.length === 0 || classCheck.rows[0].is_archived) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found."
      });
    }

    const classroom = classCheck.rows[0];

    // Authorization check: Must be the teacher owner or admin
    if (req.user.role !== "admin" && String(classroom.teacher_id) !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to update this classroom."
      });
    }

    // Name validation
    let newName = classroom.name;
    if (name !== undefined) {
      if (typeof name !== "string" || name.trim().length < 2) {
        return res.status(400).json({
          success: false,
          message: "Classroom name must be at least 2 characters long."
        });
      }
      if (name.trim().length > 150) {
        return res.status(400).json({
          success: false,
          message: "Classroom name cannot exceed 150 characters."
        });
      }
      newName = name.trim();
    }

    const result = await pool.query(
      `UPDATE classrooms
       SET name = $1,
           semester = COALESCE($2, semester),
           section = COALESCE($3, section),
           description = COALESCE($4, description),
           updated_at = NOW()
       WHERE id = $5
       RETURNING id, name, code, semester, section, description, updated_at`,
      [
        newName,
        semester !== undefined ? (semester ? String(semester).trim() : null) : null,
        section !== undefined ? (section ? String(section).trim() : null) : null,
        description !== undefined ? (description ? String(description).trim() : null) : null,
        classroomId
      ]
    );

    const updated = result.rows[0];

    await logAnalyticsEvent(req.user.id, "classroom_updated", "classrooms", classroomId, {
      name: updated.name
    });

    return res.status(200).json({
      success: true,
      message: "Classroom updated successfully.",
      classroom: updated
    });
  } catch (error) {
    console.error("Update classroom error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to update classroom."
    });
  }
};

app.patch("/api/classrooms/:id", requireAuth, requireRole(["teacher", "admin"]), handleUpdateClassroom);
app.put("/api/classrooms/:id", requireAuth, requireRole(["teacher", "admin"]), handleUpdateClassroom);

// 1c. Delete / Archive Classroom (Teacher Owner or Admin)
app.delete("/api/classrooms/:id", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const classroomId = req.params.id;

    const classCheck = await pool.query(
      "SELECT id, teacher_id, name, is_archived FROM classrooms WHERE id = $1",
      [classroomId]
    );

    if (classCheck.rows.length === 0 || classCheck.rows[0].is_archived) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found."
      });
    }

    const classroom = classCheck.rows[0];

    // Authorization check: Must be the teacher owner or admin
    if (req.user.role !== "admin" && String(classroom.teacher_id) !== String(req.user.id)) {
      return res.status(403).json({
        success: false,
        message: "You are not authorized to delete this classroom."
      });
    }

    // Soft delete / archive classroom and its linked records
    await pool.query(
      "UPDATE classrooms SET is_archived = TRUE, updated_at = NOW() WHERE id = $1",
      [classroomId]
    );

    await pool.query(
      "UPDATE classroom_subjects SET is_archived = TRUE WHERE classroom_id = $1",
      [classroomId]
    );

    await pool.query(
      "UPDATE pdfs SET is_archived = TRUE WHERE classroom_id = $1 AND access_scope = 'classroom'",
      [classroomId]
    );

    await logAnalyticsEvent(req.user.id, "classroom_deleted", "classrooms", classroomId, {
      name: classroom.name
    });

    return res.status(200).json({
      success: true,
      message: "Classroom deleted successfully."
    });
  } catch (error) {
    console.error("Delete classroom error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to delete classroom."
    });
  }
});

// 2. Get Classrooms for Current User
app.get("/api/classrooms", requireAuth, async (req, res) => {
  try {
    let result;

    if (req.user.role === "teacher") {
      result = await pool.query(
        `SELECT
          c.id,
          c.name,
          c.code,
          c.semester,
          c.section,
          c.description,
          c.created_at,
          u.name as teacher_name,
          COUNT(DISTINCT cm.student_id)::int as student_count,
          COUNT(DISTINCT cs.subject_id)::int as subject_count,
          COUNT(DISTINCT p.id)::int as resource_count
        FROM classrooms c
        JOIN users u ON c.teacher_id = u.id
        LEFT JOIN classroom_members cm ON c.id = cm.classroom_id
        LEFT JOIN classroom_subjects cs ON c.id = cs.classroom_id AND cs.is_archived = FALSE
        LEFT JOIN pdfs p ON c.id = p.classroom_id AND p.is_archived = FALSE
        WHERE c.teacher_id = $1 AND c.is_archived = FALSE
        GROUP BY c.id, u.name
        ORDER BY c.created_at DESC`,
        [req.user.id]
      );
    } else if (req.user.role === "student") {
      result = await pool.query(
        `SELECT
          c.id,
          c.name,
          c.code,
          c.semester,
          c.section,
          c.description,
          c.created_at,
          u.name as teacher_name,
          COUNT(DISTINCT cm2.student_id)::int as student_count,
          COUNT(DISTINCT cs.subject_id)::int as subject_count,
          COUNT(DISTINCT p.id)::int as resource_count,
          cm.joined_at
        FROM classrooms c
        JOIN users u ON c.teacher_id = u.id
        JOIN classroom_members cm ON c.id = cm.classroom_id AND cm.student_id = $1
        LEFT JOIN classroom_members cm2 ON c.id = cm2.classroom_id
        LEFT JOIN classroom_subjects cs ON c.id = cs.classroom_id AND cs.is_archived = FALSE
        LEFT JOIN pdfs p ON c.id = p.classroom_id AND p.is_archived = FALSE
        WHERE c.is_archived = FALSE
        GROUP BY c.id, u.name, cm.joined_at
        ORDER BY cm.joined_at DESC`,
        [req.user.id]
      );
    } else {
      // Admin gets all classrooms
      result = await pool.query(
        `SELECT
          c.id,
          c.name,
          c.code,
          c.semester,
          c.section,
          c.description,
          c.created_at,
          u.name as teacher_name,
          COUNT(DISTINCT cm.student_id)::int as student_count,
          COUNT(DISTINCT cs.subject_id)::int as subject_count,
          COUNT(DISTINCT p.id)::int as resource_count
        FROM classrooms c
        JOIN users u ON c.teacher_id = u.id
        LEFT JOIN classroom_members cm ON c.id = cm.classroom_id
        LEFT JOIN classroom_subjects cs ON c.id = cs.classroom_id AND cs.is_archived = FALSE
        LEFT JOIN pdfs p ON c.id = p.classroom_id AND p.is_archived = FALSE
        WHERE c.is_archived = FALSE
        GROUP BY c.id, u.name
        ORDER BY c.created_at DESC`
      );
    }

    return res.status(200).json({
      success: true,
      classrooms: result.rows.map((c) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        semester: c.semester,
        section: c.section,
        description: c.description,
        teacherName: c.teacher_name,
        studentCount: c.student_count,
        subjectCount: c.subject_count,
        resourceCount: c.resource_count,
        joinedAt: c.joined_at || null,
        createdAt: c.created_at
      }))
    });

  } catch (error) {
    console.error("Get classrooms error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve classrooms."
    });
  }
});

// 3. Join a Classroom (Students & Admins)
app.post("/api/classrooms/join", requireAuth, async (req, res) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== "string" || !code.trim()) {
      return res.status(400).json({
        success: false,
        message: "Please enter a valid 6-character classroom code."
      });
    }

    const cleanCode = code.trim().toUpperCase();

    // Look up active classroom
    const classResult = await pool.query(
      `SELECT c.id, c.name, c.code, c.semester, c.section, c.description, u.name as teacher_name
       FROM classrooms c
       JOIN users u ON c.teacher_id = u.id
       WHERE UPPER(c.code) = $1 AND c.is_archived = FALSE
       LIMIT 1`,
      [cleanCode]
    );

    if (classResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found. Please verify the code with your instructor."
      });
    }

    const classroom = classResult.rows[0];

    // Check if already joined
    const memberCheck = await pool.query(
      `SELECT id FROM classroom_members WHERE classroom_id = $1 AND student_id = $2`,
      [classroom.id, req.user.id]
    );

    if (memberCheck.rows.length > 0) {
      return res.status(200).json({
        success: true,
        alreadyMember: true,
        message: `You are already enrolled in ${classroom.name}.`,
        classroom: {
          id: classroom.id,
          name: classroom.name,
          code: classroom.code,
          semester: classroom.semester,
          section: classroom.section,
          teacherName: classroom.teacher_name
        }
      });
    }

    // Insert student membership
    await pool.query(
      `INSERT INTO classroom_members (classroom_id, student_id) VALUES ($1, $2)`,
      [classroom.id, req.user.id]
    );

    return res.status(200).json({
      success: true,
      alreadyMember: false,
      message: `Enrolled successfully in ${classroom.name}! All classroom subjects are now accessible in your library.`,
      classroom: {
        id: classroom.id,
        name: classroom.name,
        code: classroom.code,
        semester: classroom.semester,
        section: classroom.section,
        teacherName: classroom.teacher_name
      }
    });

  } catch (error) {
    console.error("Join classroom error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to join classroom. Please try again."
    });
  }
});

// 4. Get Classroom Details (Details, Subjects, & Student Roster)
app.get("/api/classrooms/:id", requireAuth, async (req, res) => {
  try {
    const classroomId = req.params.id;

    // Verify access
    const classResult = await pool.query(
      `SELECT c.*, u.name as teacher_name, u.email as teacher_email
       FROM classrooms c
       JOIN users u ON c.teacher_id = u.id
       WHERE c.id = $1 AND c.is_archived = FALSE
       LIMIT 1`,
      [classroomId]
    );

    if (classResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Classroom not found."
      });
    }

    const classroom = classResult.rows[0];

    const isTeacher = String(classroom.teacher_id) === String(req.user.id);
    const isAdmin = req.user.role === "admin";

    if (!isTeacher && !isAdmin) {
      const membership = await pool.query(
        `SELECT 1 FROM classroom_members WHERE classroom_id = $1 AND student_id = $2`,
        [classroomId, req.user.id]
      );
      if (membership.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "You are not enrolled in this classroom."
        });
      }
    }

    // Get subjects in this classroom
    const subjectsResult = await pool.query(
      `SELECT
        s.id,
        s.name,
        s.code,
        s.description,
        s.created_at,
        COUNT(DISTINCT CASE WHEN p.category = 'resource' THEN p.id END)::int as resource_count,
        COUNT(DISTINCT CASE WHEN p.category = 'pyq' THEN p.id END)::int as pyq_count,
        COUNT(DISTINCT p.id)::int as total_documents
      FROM classroom_subjects cs
      JOIN subjects s ON cs.subject_id = s.id
      LEFT JOIN pdfs p ON p.subject_id = s.id AND p.classroom_id = cs.classroom_id AND p.is_archived = FALSE
      WHERE cs.classroom_id = $1 AND cs.is_archived = FALSE
      GROUP BY s.id, s.name, s.code, s.description, s.created_at
      ORDER BY s.name ASC`,
      [classroomId]
    );

    // Get enrolled students (if teacher or admin)
    let students = [];
    if (isTeacher || isAdmin) {
      const studentsResult = await pool.query(
        `SELECT u.id, u.name, u.email, cm.joined_at
         FROM classroom_members cm
         JOIN users u ON cm.student_id = u.id
         WHERE cm.classroom_id = $1
         ORDER BY cm.joined_at DESC`,
        [classroomId]
      );
      students = studentsResult.rows.map((s) => ({
        id: s.id,
        name: s.name,
        email: s.email,
        joinedAt: s.joined_at
      }));
    }

    return res.status(200).json({
      success: true,
      classroom: {
        id: classroom.id,
        name: classroom.name,
        code: classroom.code,
        semester: classroom.semester,
        section: classroom.section,
        description: classroom.description,
        teacherName: classroom.teacher_name,
        teacherEmail: classroom.teacher_email,
        createdAt: classroom.created_at
      },
      subjects: subjectsResult.rows.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        description: s.description,
        resourceCount: s.resource_count,
        pyqCount: s.pyq_count,
        totalDocuments: s.total_documents,
        createdAt: s.created_at
      })),
      students
    });

  } catch (error) {
    console.error("Get classroom details error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve classroom details."
    });
  }
});

// ============================================================
// SUBJECT MANAGEMENT
// ============================================================

// 1. Add Subject to Classroom (Teacher or Admin)
app.post("/api/classrooms/:id/subjects", requireAuth, requireRole(["teacher", "admin"]), async (req, res) => {
  try {
    const classroomId = req.params.id;
    const { name, code, description } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Subject name is required."
      });
    }

    // Verify ownership of classroom
    if (req.user.role !== "admin") {
      const classCheck = await pool.query(
        "SELECT id FROM classrooms WHERE id = $1 AND teacher_id = $2 AND is_archived = FALSE",
        [classroomId, req.user.id]
      );
      if (classCheck.rows.length === 0) {
        return res.status(403).json({
          success: false,
          message: "You are not authorized to modify this classroom."
        });
      }
    }

    // Create subject
    const subjectResult = await pool.query(
      `INSERT INTO subjects (name, code, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, code, description, created_at`,
      [
        name.trim(),
        code ? String(code).trim() : null,
        description ? String(description).trim() : null,
        req.user.id
      ]
    );

    const subject = subjectResult.rows[0];

    // Link subject to classroom
    await pool.query(
      `INSERT INTO classroom_subjects (classroom_id, subject_id, teacher_id)
       VALUES ($1, $2, $3)`,
      [classroomId, subject.id, req.user.id]
    );

    return res.status(201).json({
      success: true,
      message: `Subject '${subject.name}' added to classroom.`,
      subject: {
        id: subject.id,
        name: subject.name,
        code: subject.code,
        description: subject.description,
        classroomId: Number(classroomId),
        createdAt: subject.created_at
      }
    });

  } catch (error) {
    console.error("Add subject error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to add subject to classroom."
    });
  }
});

// 2. Create Personal Subject (Student or Teacher)
app.post("/api/subjects/personal", requireAuth, async (req, res) => {
  try {
    const { name, code, description } = req.body;

    if (!name || typeof name !== "string" || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Subject name is required."
      });
    }

    const subjectResult = await pool.query(
      `INSERT INTO subjects (name, code, description, created_by)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, code, description, created_at`,
      [
        name.trim(),
        code ? String(code).trim() : null,
        description ? String(description).trim() : null,
        req.user.id
      ]
    );

    const subject = subjectResult.rows[0];

    await pool.query(
      `INSERT INTO student_subjects (student_id, subject_id)
       VALUES ($1, $2)`,
      [req.user.id, subject.id]
    );

    return res.status(201).json({
      success: true,
      message: `Personal subject '${subject.name}' created.`,
      subject: {
        id: subject.id,
        name: subject.name,
        code: subject.code,
        description: subject.description,
        isPersonal: true,
        createdAt: subject.created_at
      }
    });

  } catch (error) {
    console.error("Create personal subject error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to create personal subject."
    });
  }
});

// 3. Get All Subjects for Current User (Classroom + Personal with counts)
app.get("/api/subjects/my-subjects", requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;
    const role = req.user.role;

    let query;
    let params = [userId];

    if (role === "teacher") {
      query = `
        SELECT
          s.id,
          s.name,
          s.code,
          s.description,
          s.created_at,
          c.id as classroom_id,
          c.name as classroom_name,
          c.semester,
          c.section,
          u.name as teacher_name,
          'classroom' as subject_type,
          COUNT(DISTINCT CASE WHEN p.category = 'resource' AND p.is_archived = FALSE THEN p.id END)::int as resource_count,
          COUNT(DISTINCT CASE WHEN p.category = 'pyq' AND p.is_archived = FALSE THEN p.id END)::int as pyq_count,
          COUNT(DISTINCT CASE WHEN p.is_archived = FALSE THEN p.id END)::int as total_documents
        FROM classrooms c
        JOIN users u ON c.teacher_id = u.id
        JOIN classroom_subjects cs ON c.id = cs.classroom_id AND cs.is_archived = FALSE
        JOIN subjects s ON cs.subject_id = s.id
        LEFT JOIN pdfs p ON p.subject_id = s.id AND p.classroom_id = c.id
        WHERE c.teacher_id = $1 AND c.is_archived = FALSE
        GROUP BY s.id, s.name, s.code, s.description, s.created_at, c.id, c.name, c.semester, c.section, u.name

        UNION ALL

        SELECT
          s.id,
          s.name,
          s.code,
          s.description,
          s.created_at,
          NULL as classroom_id,
          'Personal Space' as classroom_name,
          NULL as semester,
          NULL as section,
          u.name as teacher_name,
          'personal' as subject_type,
          COUNT(DISTINCT CASE WHEN p.category = 'resource' AND p.is_archived = FALSE THEN p.id END)::int as resource_count,
          COUNT(DISTINCT CASE WHEN p.category = 'pyq' AND p.is_archived = FALSE THEN p.id END)::int as pyq_count,
          COUNT(DISTINCT CASE WHEN p.is_archived = FALSE THEN p.id END)::int as total_documents
        FROM student_subjects ss
        JOIN subjects s ON ss.subject_id = s.id
        JOIN users u ON ss.student_id = u.id
        LEFT JOIN pdfs p ON p.subject_id = s.id AND p.user_id = $1 AND p.access_scope = 'private'
        WHERE ss.student_id = $1 AND ss.is_archived = FALSE
        GROUP BY s.id, s.name, s.code, s.description, s.created_at, u.name

        ORDER BY name ASC
      `;
    } else {
      // Student or Admin
      query = `
        SELECT
          s.id,
          s.name,
          s.code,
          s.description,
          s.created_at,
          c.id as classroom_id,
          c.name as classroom_name,
          c.semester,
          c.section,
          u.name as teacher_name,
          'classroom' as subject_type,
          COUNT(DISTINCT CASE WHEN p.category = 'resource' AND p.is_archived = FALSE THEN p.id END)::int as resource_count,
          COUNT(DISTINCT CASE WHEN p.category = 'pyq' AND p.is_archived = FALSE THEN p.id END)::int as pyq_count,
          COUNT(DISTINCT CASE WHEN p.is_archived = FALSE THEN p.id END)::int as total_documents
        FROM classroom_members cm
        JOIN classrooms c ON cm.classroom_id = c.id AND c.is_archived = FALSE
        JOIN users u ON c.teacher_id = u.id
        JOIN classroom_subjects cs ON c.id = cs.classroom_id AND cs.is_archived = FALSE
        JOIN subjects s ON cs.subject_id = s.id
        LEFT JOIN pdfs p ON p.subject_id = s.id AND (p.classroom_id = c.id OR (p.user_id = $1 AND p.classroom_id IS NULL))
        WHERE cm.student_id = $1
        GROUP BY s.id, s.name, s.code, s.description, s.created_at, c.id, c.name, c.semester, c.section, u.name

        UNION ALL

        SELECT
          s.id,
          s.name,
          s.code,
          s.description,
          s.created_at,
          NULL as classroom_id,
          'Personal Space' as classroom_name,
          NULL as semester,
          NULL as section,
          u.name as teacher_name,
          'personal' as subject_type,
          COUNT(DISTINCT CASE WHEN p.category = 'resource' AND p.is_archived = FALSE THEN p.id END)::int as resource_count,
          COUNT(DISTINCT CASE WHEN p.category = 'pyq' AND p.is_archived = FALSE THEN p.id END)::int as pyq_count,
          COUNT(DISTINCT CASE WHEN p.is_archived = FALSE THEN p.id END)::int as total_documents
        FROM student_subjects ss
        JOIN subjects s ON ss.subject_id = s.id
        JOIN users u ON ss.student_id = u.id
        LEFT JOIN pdfs p ON p.subject_id = s.id AND p.user_id = $1 AND p.access_scope = 'private'
        WHERE ss.student_id = $1 AND ss.is_archived = FALSE
        GROUP BY s.id, s.name, s.code, s.description, s.created_at, u.name

        ORDER BY name ASC
      `;
    }

    const result = await pool.query(query, params);

    return res.status(200).json({
      success: true,
      subjects: result.rows.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
        description: s.description,
        classroomId: s.classroom_id,
        classroomName: s.classroom_name,
        semester: s.semester,
        section: s.section,
        teacherName: s.teacher_name,
        subjectType: s.subject_type,
        resourceCount: s.resource_count,
        pyqCount: s.pyq_count,
        totalDocuments: s.total_documents,
        createdAt: s.created_at
      }))
    });

  } catch (error) {
    console.error("Get my subjects error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve subjects."
    });
  }
});

// 4. Get Subject Details and Resources/PYQs
app.get("/api/subjects/:id", requireAuth, async (req, res) => {
  try {
    const subjectId = req.params.id;

    // Get subject information
    const subjectResult = await pool.query(
      `SELECT
        s.id,
        s.name,
        s.code,
        s.description,
        s.created_at,
        c.id as classroom_id,
        c.name as classroom_name,
        c.semester,
        c.section,
        u.name as teacher_name
      FROM subjects s
      LEFT JOIN classroom_subjects cs ON s.id = cs.subject_id AND cs.is_archived = FALSE
      LEFT JOIN classrooms c ON cs.classroom_id = c.id
      LEFT JOIN users u ON c.teacher_id = u.id
      WHERE s.id = $1
      LIMIT 1`,
      [subjectId]
    );

    if (subjectResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Subject not found."
      });
    }

    const subject = subjectResult.rows[0];

    // Fetch accessible documents for this subject
    const docsResult = await pool.query(
      `SELECT
        p.id,
        p.user_id,
        p.filename,
        p.original_filename,
        p.file_url,
        p.file_size,
        p.page_count,
        p.processing_status,
        p.category,
        p.academic_year,
        p.semester,
        p.classroom_id,
        p.subject_id,
        p.access_scope,
        p.created_at,
        u.name as uploader_name,
        u.role as uploader_role
      FROM pdfs p
      JOIN users u ON p.user_id = u.id
      WHERE p.subject_id = $1
        AND p.is_archived = FALSE
        AND (
          p.user_id = $2
          OR (
            p.access_scope = 'classroom'
            AND p.classroom_id IS NOT NULL
            AND (
              EXISTS (
                SELECT 1 FROM classroom_members cm 
                WHERE cm.classroom_id = p.classroom_id AND cm.student_id = $2
              )
              OR EXISTS (
                SELECT 1 FROM classrooms cl 
                WHERE cl.id = p.classroom_id AND cl.teacher_id = $2
              )
            )
          )
          OR $3 = 'admin'
        )
      ORDER BY p.created_at DESC`,
      [subjectId, req.user.id, req.user.role]
    );

    const resources = [];
    const pyqs = [];

    docsResult.rows.forEach((doc) => {
      const item = {
        id: doc.id,
        filename: doc.filename,
        originalFilename: doc.original_filename,
        fileUrl: doc.file_url,
        fileSize: doc.file_size,
        fileType: getFileType(doc.original_filename || doc.filename),
        pageCount: doc.page_count,
        processingStatus: doc.processing_status,
        category: doc.category,
        academicYear: doc.academic_year,
        semester: doc.semester,
        classroomId: doc.classroom_id,
        accessScope: doc.access_scope,
        uploadedBy: {
          name: doc.uploader_name,
          role: doc.uploader_role,
          isMe: String(doc.user_id) === String(req.user.id)
        },
        createdAt: doc.created_at
      };

      if (doc.category === "pyq") {
        pyqs.push(item);
      } else {
        resources.push(item);
      }
    });

    return res.status(200).json({
      success: true,
      subject: {
        id: subject.id,
        name: subject.name,
        code: subject.code,
        description: subject.description,
        classroomId: subject.classroom_id,
        classroomName: subject.classroom_name,
        semester: subject.semester,
        section: subject.section,
        teacherName: subject.teacher_name,
        createdAt: subject.created_at
      },
      resources,
      pyqs
    });

  } catch (error) {
    console.error("Get subject details error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve subject details."
    });
  }
});

// ============================================================
// SUBJECT-LEVEL AI (MULTI-DOCUMENT SYNTHESIS & PYQ ANALYSIS)
// ============================================================

// 1. Analyze All Study Resources in Subject
app.post("/api/subjects/:id/ai/analyze-resources", requireAuth, async (req, res) => {
  try {
    const subjectId = req.params.id;

    const docsResult = await pool.query(
      `SELECT p.id, p.filename, p.original_filename, p.storage_path, p.user_id
       FROM pdfs p
       WHERE p.subject_id = $1
         AND p.category = 'resource'
         AND p.is_archived = FALSE
         AND (
           p.user_id = $2
           OR (
             p.access_scope = 'classroom'
             AND (
               EXISTS (SELECT 1 FROM classroom_members cm WHERE cm.classroom_id = p.classroom_id AND cm.student_id = $2)
               OR EXISTS (SELECT 1 FROM classrooms cl WHERE cl.id = p.classroom_id AND cl.teacher_id = $2)
             )
           )
           OR $3 = 'admin'
         )
       LIMIT 8`,
      [subjectId, req.user.id, req.user.role]
    );

    if (docsResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No study resource documents found in this subject to analyze. Please upload notes or lecture slides first."
      });
    }

    let combinedText = "";
    const processedDocs = [];

    for (const doc of docsResult.rows) {
      try {
        const { filePath, isTemp } = await getDocumentLocalPath(doc);
        try {
          const ast = await officeParser.parseOffice(filePath);
          const parsed = await ast.to("text");
          const text = String(parsed.value || "").trim();
          if (text) {
            combinedText += `\n\n--- Document: ${doc.original_filename} ---\n` + text.slice(0, 3000);
            processedDocs.push(doc.original_filename);
          }
        } finally {
          if (isTemp && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (_) {}
          }
        }
      } catch (e) {
        console.warn("Could not extract text from", doc.filename, e.message);
      }
    }

    if (!combinedText.trim()) {
      combinedText = `Subject Study Resources:\n` + docsResult.rows.map(d => `- ${d.original_filename}`).join("\n");
      docsResult.rows.forEach(d => processedDocs.push(d.original_filename));
    }

    let result;
    try {
      result = await ragService.answer({
        mode: "overview",
        question: "Provide an integrated subject study guide: main topics covered across all resources, core definitions, syllabus breakdown, and key revision highlights.",
        text: combinedText
      });
    } catch (aiErr) {
      console.error("Subject AI analyze resources error:", aiErr.message);
      return res.status(502).json({
        success: false,
        message: aiErr.message || "Unable to analyze subject resources with Gemini AI."
      });
    }

    return res.status(200).json({
      success: true,
      subjectId,
      analyzedDocuments: processedDocs,
      ...result
    });

  } catch (error) {
    console.error("Subject AI analyze resources error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to analyze subject resources."
    });
  }
});

// 2. Analyze PYQs in Subject (Frequency, Repeated Topics, Weightage)
app.post("/api/subjects/:id/ai/analyze-pyqs", requireAuth, async (req, res) => {
  try {
    const subjectId = req.params.id;

    const docsResult = await pool.query(
      `SELECT p.id, p.filename, p.original_filename, p.academic_year, p.storage_path, p.user_id
       FROM pdfs p
       WHERE p.subject_id = $1
         AND p.category = 'pyq'
         AND p.is_archived = FALSE
         AND (
           p.user_id = $2
           OR (
             p.access_scope = 'classroom'
             AND (
               EXISTS (SELECT 1 FROM classroom_members cm WHERE cm.classroom_id = p.classroom_id AND cm.student_id = $2)
               OR EXISTS (SELECT 1 FROM classrooms cl WHERE cl.id = p.classroom_id AND cl.teacher_id = $2)
             )
           )
           OR $3 = 'admin'
         )
       LIMIT 8`,
      [subjectId, req.user.id, req.user.role]
    );

    if (docsResult.rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No Previous Year Question papers (PYQs) found in this subject. Please upload PYQs first."
      });
    }

    let combinedText = "";
    const processedDocs = [];

    for (const doc of docsResult.rows) {
      try {
        const { filePath, isTemp } = await getDocumentLocalPath(doc);
        try {
          const ast = await officeParser.parseOffice(filePath);
          const parsed = await ast.to("text");
          const text = String(parsed.value || "").trim();
          if (text) {
            combinedText += `\n\n--- PYQ Paper [${doc.academic_year || "Unknown Year"}]: ${doc.original_filename} ---\n` + text.slice(0, 3000);
            processedDocs.push(`${doc.original_filename} (${doc.academic_year || "N/A"})`);
          }
        } finally {
          if (isTemp && fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (_) {}
          }
        }
      } catch (e) {
        console.warn("Could not extract text from PYQ", doc.filename, e.message);
      }
    }

    if (!combinedText.trim()) {
      combinedText = `Previous Year Exam Question Papers:\n` + docsResult.rows.map(d => `- Paper: ${d.original_filename} (Year: ${d.academic_year || "Unknown"})`).join("\n");
      docsResult.rows.forEach(d => processedDocs.push(`${d.original_filename} (${d.academic_year || "N/A"})`));
    }

    let result;
    try {
      result = await ragService.answer({
        mode: "explanation",
        question: "Analyze these Previous Year Question papers. Identify recurring questions, high-frequency topics, repeated patterns across academic years, and high-yield study topics for final exams.",
        text: combinedText
      });
    } catch (aiErr) {
      console.error("Subject AI analyze PYQs error:", aiErr.message);
      return res.status(502).json({
        success: false,
        message: aiErr.message || "Unable to analyze subject PYQs with Gemini AI."
      });
    }

    return res.status(200).json({
      success: true,
      subjectId,
      analyzedPapers: processedDocs,
      ...result
    });

  } catch (error) {
    console.error("Subject AI analyze PYQs error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to analyze subject PYQs."
    });
  }
});

// ============================================================
// ADMIN METRICS & USER MANAGEMENT
// ============================================================

app.get("/api/admin/metrics", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const userStats = await pool.query(`
      SELECT
        COUNT(*)::int as total_users,
        COUNT(CASE WHEN role = 'student' THEN 1 END)::int as student_count,
        COUNT(CASE WHEN role = 'teacher' THEN 1 END)::int as teacher_count,
        COUNT(CASE WHEN role = 'admin' THEN 1 END)::int as admin_count
      FROM users
    `);

    const classStats = await pool.query(`
      SELECT COUNT(*)::int as total_classrooms FROM classrooms WHERE is_archived = FALSE
    `);

    const docStats = await pool.query(`
      SELECT
        COUNT(*)::int as total_documents,
        COUNT(CASE WHEN category = 'resource' THEN 1 END)::int as resource_count,
        COUNT(CASE WHEN category = 'pyq' THEN 1 END)::int as pyq_count
      FROM pdfs
      WHERE is_archived = FALSE
    `);

    const subjectStats = await pool.query(`
      SELECT COUNT(*)::int as total_subjects FROM subjects
    `);

    const jobStats = await pool.query(`
      SELECT
        COUNT(*)::int as total_jobs,
        COUNT(CASE WHEN status = 'pending' THEN 1 END)::int as pending_jobs,
        COUNT(CASE WHEN status = 'processing' THEN 1 END)::int as processing_jobs,
        COUNT(CASE WHEN status = 'completed' THEN 1 END)::int as completed_jobs,
        COUNT(CASE WHEN status = 'failed' THEN 1 END)::int as failed_jobs
      FROM document_jobs
    `);

    let storageMetrics = { totalFiles: 0, totalBytes: 0, provider: "cloud" };
    try {
      storageMetrics = await cloudStorage.getStorageMetrics();
    } catch (_) {}

    const recentActivity = await pool.query(`
      SELECT id, event_name, entity_type, entity_id, created_at
      FROM analytics_events
      ORDER BY created_at DESC
      LIMIT 10
    `);

    return res.status(200).json({
      success: true,
      metrics: {
        totalUsers: userStats.rows[0].total_users,
        studentCount: userStats.rows[0].student_count,
        teacherCount: userStats.rows[0].teacher_count,
        adminCount: userStats.rows[0].admin_count,
        totalClassrooms: classStats.rows[0].total_classrooms,
        totalSubjects: subjectStats.rows[0].total_subjects,
        totalDocuments: docStats.rows[0].total_documents,
        resourceCount: docStats.rows[0].resource_count,
        pyqCount: docStats.rows[0].pyq_count,
        jobs: {
          total: jobStats.rows[0].total_jobs,
          pending: jobStats.rows[0].pending_jobs,
          processing: jobStats.rows[0].processing_jobs,
          completed: jobStats.rows[0].completed_jobs,
          failed: jobStats.rows[0].failed_jobs
        },
        storage: {
          totalFiles: storageMetrics.totalFiles,
          totalBytes: storageMetrics.totalBytes,
          provider: storageMetrics.provider || "cloud"
        },
        recentActivity: recentActivity.rows
      }
    });

  } catch (error) {
    console.error("Admin metrics error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve system metrics."
    });
  }
});

app.get("/api/admin/users", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, name, email, role, is_active, is_approved, created_at, last_login
      FROM users
      ORDER BY created_at DESC
    `);

    return res.status(200).json({
      success: true,
      users: result.rows
    });
  } catch (error) {
    console.error("Admin get users error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve users."
    });
  }
});

app.post("/api/admin/users/:id/approve", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const result = await pool.query(`
      UPDATE users
      SET is_approved = NOT is_approved
      WHERE id = $1
      RETURNING id, name, email, role, is_approved
    `, [req.params.id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    return res.status(200).json({
      success: true,
      message: `User ${result.rows[0].name} approval status updated to ${result.rows[0].is_approved}.`,
      user: result.rows[0]
    });
  } catch (error) {
    console.error("Admin approve user error:", error);
    return res.status(500).json({ success: false, message: "Unable to update approval status." });
  }
});

// Admin AI Provider Status Monitoring
app.get("/api/admin/ai/status", requireAuth, requireRole(["admin"]), (req, res) => {
  try {
    const status = aiProviderRouter.getProviderStatus();
    return res.status(200).json({
      success: true,
      status
    });
  } catch (error) {
    console.error("Admin AI status error:", error);
    return res.status(500).json({ success: false, message: "Unable to retrieve AI status." });
  }
});

// Admin AI Cache Metrics
app.get("/api/admin/cache/metrics", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const metrics = await aiCacheService.getCacheMetrics();
    return res.status(200).json({
      success: true,
      metrics
    });
  } catch (error) {
    console.error("Admin cache metrics error:", error);
    return res.status(500).json({ success: false, message: "Unable to retrieve cache metrics." });
  }
});

// Admin Academic Management (Classrooms & Subjects)
app.get("/api/admin/academic", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const classroomsRes = await pool.query(`
      SELECT
        c.id, c.name, c.code, c.semester, c.section, c.description, c.is_archived, c.created_at,
        u.name as teacher_name, u.email as teacher_email,
        COUNT(DISTINCT cm.student_id)::int as student_count,
        COUNT(DISTINCT cs.subject_id)::int as subject_count,
        COUNT(DISTINCT p.id)::int as material_count
      FROM classrooms c
      JOIN users u ON c.teacher_id = u.id
      LEFT JOIN classroom_members cm ON c.id = cm.classroom_id
      LEFT JOIN classroom_subjects cs ON c.id = cs.classroom_id AND cs.is_archived = FALSE
      LEFT JOIN pdfs p ON c.id = p.classroom_id AND p.is_archived = FALSE
      GROUP BY c.id, u.name, u.email
      ORDER BY c.created_at DESC
    `);

    const subjectsRes = await pool.query(`
      SELECT
        s.id, s.name, s.code, s.description, s.created_at,
        u.name as creator_name,
        COUNT(DISTINCT cs.classroom_id)::int as classroom_count,
        COUNT(DISTINCT p.id)::int as document_count
      FROM subjects s
      LEFT JOIN users u ON s.created_by = u.id
      LEFT JOIN classroom_subjects cs ON s.id = cs.subject_id AND cs.is_archived = FALSE
      LEFT JOIN pdfs p ON s.id = p.subject_id AND p.is_archived = FALSE
      GROUP BY s.id, u.name
      ORDER BY s.created_at DESC
    `);

    return res.status(200).json({
      success: true,
      classrooms: classroomsRes.rows,
      subjects: subjectsRes.rows
    });
  } catch (error) {
    console.error("Admin academic overview error:", error);
    return res.status(500).json({ success: false, message: "Unable to retrieve academic data." });
  }
});

// Admin Document Job Queue Monitoring
app.get("/api/admin/jobs", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const jobsRes = await pool.query(`
      SELECT
        j.id, j.pdf_id, j.job_type, j.status, j.attempts, j.max_attempts,
        j.progress, j.error_message, j.created_at, j.updated_at,
        p.filename, p.original_filename
      FROM document_jobs j
      LEFT JOIN pdfs p ON j.pdf_id = p.id
      ORDER BY j.created_at DESC
      LIMIT 100
    `);

    return res.status(200).json({
      success: true,
      jobs: jobsRes.rows
    });
  } catch (error) {
    console.error("Admin jobs error:", error);
    return res.status(500).json({ success: false, message: "Unable to retrieve background jobs." });
  }
});

// Admin Toggle User Active Status (with self-deactivation protection & audit)
app.post("/api/admin/users/:id/toggle-status", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ success: false, message: "Invalid user ID." });
    }

    if (parseInt(req.user.id, 10) === targetId) {
      return res.status(400).json({ success: false, message: "Cannot deactivate your own administrator account." });
    }

    const result = await pool.query(`
      UPDATE users
      SET is_active = NOT is_active
      WHERE id = $1
      RETURNING id, name, email, role, is_active, is_approved
    `, [targetId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found." });
    }

    const updatedUser = result.rows[0];

    try {
      await pool.query(`
        INSERT INTO analytics_events (user_id, event_name, entity_type, entity_id, metadata)
        VALUES ($1, 'admin_user_status_toggled', 'user', $2, $3)
      `, [
        req.user.id,
        targetId,
        JSON.stringify({
          toggled_by: req.user.id,
          new_is_active: updatedUser.is_active,
          user_email: updatedUser.email
        })
      ]);
    } catch (auditErr) {
      console.warn("Audit log insert warning:", auditErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `User ${updatedUser.name} status updated to ${updatedUser.is_active ? 'Active' : 'Inactive'}.`,
      user: updatedUser
    });
  } catch (error) {
    console.error("Admin toggle status error:", error);
    return res.status(500).json({ success: false, message: "Unable to toggle user active status." });
  }
});

// Admin System & Audit Logs
app.get("/api/admin/logs", requireAuth, requireRole(["admin"]), async (req, res) => {
  try {
    const logsRes = await pool.query(`
      SELECT
        a.id, a.user_id, a.event_name, a.entity_type, a.entity_id, a.metadata, a.created_at,
        u.email as user_email, u.role as user_role
      FROM analytics_events a
      LEFT JOIN users u ON a.user_id = u.id
      ORDER BY a.created_at DESC
      LIMIT 100
    `);

    // Sanitize metadata to never leak sensitive data
    const sanitizedLogs = logsRes.rows.map(log => {
      let meta = log.metadata;
      if (meta && typeof meta === "object") {
        const cleanMeta = { ...meta };
        delete cleanMeta.password;
        delete cleanMeta.password_hash;
        delete cleanMeta.token;
        delete cleanMeta.apiKey;
        delete cleanMeta.key;
        delete cleanMeta.secret;
        meta = cleanMeta;
      }
      return {
        id: log.id,
        userId: log.user_id,
        userEmail: log.user_email || "System",
        userRole: log.user_role || "system",
        eventName: log.event_name,
        entityType: log.entity_type,
        entityId: log.entity_id,
        metadata: meta,
        createdAt: log.created_at
      };
    });

    return res.status(200).json({
      success: true,
      logs: sanitizedLogs
    });
  } catch (error) {
    console.error("Admin logs error:", error);
    return res.status(500).json({ success: false, message: "Unable to retrieve system logs." });
  }
});

// ============================================================
// NOTIFICATIONS SYSTEM (PostgreSQL primary + optional Firestore)
// ============================================================

async function createNotification(userId, classroomId, title, message, type = "announcement") {
  try {
    const res = await pool.query(
      `INSERT INTO notifications (user_id, classroom_id, title, message, type, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, FALSE, CURRENT_TIMESTAMP)
       RETURNING id, user_id, classroom_id, title, message, type, is_read, created_at`,
      [userId, classroomId || null, title, message, type]
    );

    const notif = res.rows[0];

    // Optional realtime mirror to Firestore if initialized
    try {
      const admin = global.firebaseAdmin || null;
      if (admin && admin.apps && admin.apps.length > 0) {
        const firestore = admin.firestore();
        await firestore.collection("users").doc(String(userId)).collection("notifications").doc(String(notif.id)).set({
          id: notif.id,
          classroomId: notif.classroom_id,
          title: notif.title,
          message: notif.message,
          type: notif.type,
          isRead: false,
          createdAt: notif.created_at
        });
      }
    } catch (_) {}

    return notif;
  } catch (err) {
    console.error("[Notifications] Failed to create notification:", err.message);
    return null;
  }
}

async function notifyClassroomStudents(classroomId, title, message, type = "material_added") {
  try {
    const members = await pool.query(
      "SELECT student_id FROM classroom_members WHERE classroom_id = $1",
      [classroomId]
    );
    for (const row of members.rows) {
      await createNotification(row.student_id, classroomId, title, message, type);
    }
  } catch (err) {
    console.error("[Notifications] Failed to notify classroom students:", err.message);
  }
}

// 1. Get Notifications for Current User
app.get("/api/notifications", requireAuth, async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 30, 100);
    const notificationsResult = await pool.query(
      `SELECT n.id, n.user_id, n.classroom_id, n.title, n.message, n.type, n.is_read, n.created_at,
              c.name as classroom_name
       FROM notifications n
       LEFT JOIN classrooms c ON n.classroom_id = c.id
       WHERE n.user_id = $1
       ORDER BY n.created_at DESC
       LIMIT $2`,
      [req.user.id, limit]
    );

    const unreadResult = await pool.query(
      `SELECT COUNT(*)::int as unread_count
       FROM notifications
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );

    const unreadCount = unreadResult.rows[0]?.unread_count || 0;

    return res.status(200).json({
      success: true,
      notifications: notificationsResult.rows.map((n) => ({
        id: n.id,
        classroomId: n.classroom_id,
        classroomName: n.classroom_name,
        title: n.title,
        message: n.message,
        type: n.type,
        isRead: n.is_read,
        createdAt: n.created_at
      })),
      unreadCount
    });
  } catch (error) {
    console.error("Get notifications error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to retrieve notifications."
    });
  }
});

// 2. Mark Single Notification as Read
app.patch("/api/notifications/:id/read", requireAuth, async (req, res) => {
  try {
    const notifId = req.params.id;
    const result = await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE id = $1 AND user_id = $2
       RETURNING id, is_read`,
      [notifId, req.user.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Notification not found."
      });
    }

    return res.status(200).json({
      success: true,
      message: "Notification marked as read."
    });
  } catch (error) {
    console.error("Mark notification read error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to mark notification as read."
    });
  }
});

// 3. Mark All Notifications as Read
app.post("/api/notifications/mark-all-read", requireAuth, async (req, res) => {
  try {
    await pool.query(
      `UPDATE notifications
       SET is_read = TRUE
       WHERE user_id = $1 AND is_read = FALSE`,
      [req.user.id]
    );

    return res.status(200).json({
      success: true,
      message: "All notifications marked as read."
    });
  } catch (error) {
    console.error("Mark all notifications read error:", error);
    return res.status(500).json({
      success: false,
      message: "Unable to mark notifications as read."
    });
  }
});

// ============================================================
// GLOBAL UNIFIED SEARCH API (Role-Scoped & Secure)
// ============================================================
app.get("/api/search", requireAuth, async (req, res) => {
  try {
    const query = (req.query.q || "").trim();

    if (!query || query.length < 2) {
      return res.status(200).json({
        success: true,
        query,
        results: { classrooms: [], subjects: [], documents: [] },
        total: 0
      });
    }

    const searchTerm = `%${query}%`;
    const userId = req.user.id;
    const userRole = req.user.role;

    let classrooms = [];
    let subjects = [];
    let documents = [];

    if (userRole === "admin") {
      const classRes = await pool.query(
        `SELECT id, name, code, semester, section
         FROM classrooms
         WHERE is_archived = FALSE AND (name ILIKE $1 OR code ILIKE $1)
         ORDER BY name ASC LIMIT 10`,
        [searchTerm]
      );
      classrooms = classRes.rows;

      const subRes = await pool.query(
        `SELECT s.id, s.name, s.code, c.id as classroom_id, c.name as classroom_name
         FROM subjects s
         LEFT JOIN classroom_subjects cs ON s.id = cs.subject_id AND cs.is_archived = FALSE
         LEFT JOIN classrooms c ON cs.classroom_id = c.id
         WHERE s.name ILIKE $1 OR s.code ILIKE $1
         ORDER BY s.name ASC LIMIT 10`,
        [searchTerm]
      );
      subjects = subRes.rows;

      const docRes = await pool.query(
        `SELECT p.id, p.filename, p.original_filename, p.category, p.classroom_id, p.subject_id,
                c.name as classroom_name, s.name as subject_name
         FROM pdfs p
         LEFT JOIN classrooms c ON p.classroom_id = c.id
         LEFT JOIN subjects s ON p.subject_id = s.id
         WHERE p.is_archived = FALSE AND (p.original_filename ILIKE $1 OR p.filename ILIKE $1)
         ORDER BY p.created_at DESC LIMIT 15`,
        [searchTerm]
      );
      documents = docRes.rows;

    } else if (userRole === "teacher") {
      const classRes = await pool.query(
        `SELECT id, name, code, semester, section
         FROM classrooms
         WHERE teacher_id = $1 AND is_archived = FALSE AND (name ILIKE $2 OR code ILIKE $2)
         ORDER BY name ASC LIMIT 10`,
        [userId, searchTerm]
      );
      classrooms = classRes.rows;

      const subRes = await pool.query(
        `SELECT DISTINCT s.id, s.name, s.code, c.id as classroom_id, c.name as classroom_name
         FROM subjects s
         JOIN classroom_subjects cs ON s.id = cs.subject_id AND cs.is_archived = FALSE
         JOIN classrooms c ON cs.classroom_id = c.id
         WHERE c.teacher_id = $1 AND (s.name ILIKE $2 OR s.code ILIKE $2)
         ORDER BY s.name ASC LIMIT 10`,
        [userId, searchTerm]
      );
      subjects = subRes.rows;

      const docRes = await pool.query(
        `SELECT p.id, p.filename, p.original_filename, p.category, p.classroom_id, p.subject_id,
                c.name as classroom_name, s.name as subject_name
         FROM pdfs p
         LEFT JOIN classrooms c ON p.classroom_id = c.id
         LEFT JOIN subjects s ON p.subject_id = s.id
         WHERE p.is_archived = FALSE
           AND (p.user_id = $1 OR c.teacher_id = $1)
           AND (p.original_filename ILIKE $2 OR p.filename ILIKE $2)
         ORDER BY p.created_at DESC LIMIT 15`,
        [userId, searchTerm]
      );
      documents = docRes.rows;

    } else {
      // Student: only enrolled classrooms, subjects in enrolled classrooms, and accessible documents
      const classRes = await pool.query(
        `SELECT c.id, c.name, c.code, c.semester, c.section, u.name as teacher_name
         FROM classrooms c
         JOIN users u ON c.teacher_id = u.id
         JOIN classroom_members cm ON c.id = cm.classroom_id AND cm.student_id = $1
         WHERE c.is_archived = FALSE AND (c.name ILIKE $2 OR c.code ILIKE $2)
         ORDER BY c.name ASC LIMIT 10`,
        [userId, searchTerm]
      );
      classrooms = classRes.rows;

      const subRes = await pool.query(
        `SELECT DISTINCT s.id, s.name, s.code, c.id as classroom_id, c.name as classroom_name
         FROM subjects s
         LEFT JOIN classroom_subjects cs ON s.id = cs.subject_id AND cs.is_archived = FALSE
         LEFT JOIN classrooms c ON cs.classroom_id = c.id
         LEFT JOIN classroom_members cm ON c.id = cm.classroom_id AND cm.student_id = $1
         LEFT JOIN student_subjects ss ON s.id = ss.subject_id AND ss.student_id = $1
         WHERE (cm.student_id = $1 OR ss.student_id = $1)
           AND (s.name ILIKE $2 OR s.code ILIKE $2)
         ORDER BY s.name ASC LIMIT 10`,
        [userId, searchTerm]
      );
      subjects = subRes.rows;

      const docRes = await pool.query(
        `SELECT p.id, p.filename, p.original_filename, p.category, p.classroom_id, p.subject_id,
                c.name as classroom_name, s.name as subject_name
         FROM pdfs p
         LEFT JOIN classrooms c ON p.classroom_id = c.id
         LEFT JOIN subjects s ON p.subject_id = s.id
         WHERE p.is_archived = FALSE
           AND (
             p.user_id = $1
             OR (
               p.access_scope = 'classroom'
               AND p.classroom_id IN (
                 SELECT classroom_id FROM classroom_members WHERE student_id = $1
               )
             )
           )
           AND (p.original_filename ILIKE $2 OR p.filename ILIKE $2)
         ORDER BY p.created_at DESC LIMIT 15`,
        [userId, searchTerm]
      );
      documents = docRes.rows;
    }

    const total = classrooms.length + subjects.length + documents.length;

    return res.status(200).json({
      success: true,
      query,
      results: {
        classrooms: classrooms.map(c => ({
          id: c.id,
          name: c.name,
          code: c.code,
          semester: c.semester,
          section: c.section,
          teacherName: c.teacher_name
        })),
        subjects: subjects.map(s => ({
          id: s.id,
          name: s.name,
          code: s.code,
          classroomId: s.classroom_id,
          classroomName: s.classroom_name
        })),
        documents: documents.map(d => ({
          id: d.id,
          filename: d.filename,
          originalFilename: d.original_filename,
          fileType: getFileType(d.original_filename || d.filename),
          category: d.category,
          classroomId: d.classroom_id,
          classroomName: d.classroom_name,
          subjectId: d.subject_id,
          subjectName: d.subject_name
        }))
      },
      total
    });

  } catch (error) {
    console.error("Global search error:", error);
    return res.status(500).json({
      success: false,
      message: "An error occurred while executing search."
    });
  }
});

// ============================================================
// Start Server
// ============================================================

let serverInstance = null;

async function startServer() {
  try {
    await pool.query("SELECT 1");

    console.log("PostgreSQL connected successfully.");

    if (process.env.NODE_ENV !== "test" && !process.env.VERCEL) {
      serverInstance = app.listen(PORT, () => {
        console.log(`StudyReader backend running on http://localhost:${PORT}`);
        // Start background durable queue worker
        jobProcessor.startWorker(4000);
      });

      // Keep event loop active indefinitely on Windows
      setInterval(() => {}, 1000 * 60 * 60);

      serverInstance.on("close", () => console.log("SERVER CLOSED EVENT TRIGGERED"));
    }
  } catch (error) {
    console.error("Failed to connect to PostgreSQL.", error);

    if (!process.env.VERCEL) {
      process.exit(1);
    }
  }
}

process.on("beforeExit", (code) => {
  console.log("PROCESS BEFORE EXIT TRIGGERED, CODE:", code);
  console.log("ACTIVE HANDLES:", process._getActiveHandles());
});

process.on("exit", (code) => {
  console.log("PROCESS EXIT TRIGGERED, CODE:", code);
});

startServer();

module.exports = { app, pool, jobProcessor, startServer };

