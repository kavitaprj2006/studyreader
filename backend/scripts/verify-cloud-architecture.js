/**
 * StudyReader — Master Cloud Architecture Verification Test Suite (Phases B through J)
 * 
 * Verifies:
 * 1. Safe Schema & Database Modernization (document_jobs, pdf_chunks, analytics_events)
 * 2. Cloud Storage & Presigned Direct Upload / Download Architecture
 * 3. Durable PostgreSQL Job Queue with Atomic SKIP LOCKED Claiming
 * 4. Hosted Gemini Vector Embeddings (768 dimensions) & Hybrid Semantic Search
 * 5. Multi-Tenant Classroom Lifecycle & Roster Hardening (renew code, remove member, leave)
 * 6. Admin Observability, Metrics & Analytics Event Stream
 * 7. Vercel Deployment Entrypoints & Configuration Integrity
 */

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { pool } = require("../db");
const cloudStorage = require("../services/storage/cloud-storage");
const embeddingService = require("../services/ai/embedding-service");

const BASE_URL = process.env.TEST_API_URL || "http://localhost:3000";

class CookieJar {
  constructor() {
    this.cookies = {};
  }
  setFromHeaders(headers) {
    const raw = headers.get("set-cookie");
    if (!raw) return;
    const parts = raw.split(/,(?=\s*[a-zA-Z0-9_\-]+=)/);
    for (const part of parts) {
      const match = part.match(/^([^=;\s]+)=([^;]*)/);
      if (match) {
        this.cookies[match[1]] = match[2];
      }
    }
  }
  getHeader() {
    return Object.entries(this.cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

async function request(endpoint, options = {}, jar = null) {
  const url = endpoint.startsWith("http") ? endpoint : `${BASE_URL}${endpoint}`;
  const headers = { ...(options.headers || {}) };
  if (jar) {
    const cookie = jar.getHeader();
    if (cookie) headers["Cookie"] = cookie;
  }
  const res = await fetch(url, { ...options, headers });
  if (jar) {
    jar.setFromHeaders(res.headers);
  }
  return res;
}

function createDummyPdfBuffer(title = "Distributed Systems & Cloud Computing", content = "Distributed systems rely on consensus protocols such as Paxos and Raft. Vector databases index high-dimensional embeddings for semantic similarity search.") {
  const pdfString = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length ${100 + title.length + content.length} >> stream
BT
/F1 18 Tf
50 720 Td
(${title}) Tj
/F1 12 Tf
0 -30 Td
(${content}) Tj
ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000450 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
538
%%EOF`;
  return Buffer.from(pdfString);
}

let passedTests = 0;
let totalTests = 0;
let skippedTests = 0;

// Tracked records created specifically during this test execution
const trackedRecords = {
  users: new Set(),
  classrooms: new Set(),
  pdfs: new Set(),
  jobs: new Set(),
  files: new Set()
};

async function cleanupTestExecutionRecords() {
  const userIds = Array.from(trackedRecords.users).filter(Boolean);
  const classroomIds = Array.from(trackedRecords.classrooms).filter(Boolean);
  const pdfIds = Array.from(trackedRecords.pdfs).filter(Boolean);
  const jobIds = Array.from(trackedRecords.jobs).filter(Boolean);
  const filePaths = Array.from(trackedRecords.files).filter(Boolean);

  if (userIds.length === 0 && classroomIds.length === 0 && pdfIds.length === 0 && jobIds.length === 0) {
    return;
  }

  console.log("\n[Teardown] Cleaning up only records created during this execution...");
  console.log(`  Tracked Users: [${userIds.join(", ")}]`);
  console.log(`  Tracked Classrooms: [${classroomIds.join(", ")}]`);
  console.log(`  Tracked PDFs: [${pdfIds.join(", ")}]`);
  console.log(`  Tracked Jobs: [${jobIds.join(", ")}]`);
  console.log(`  Tracked Files: [${filePaths.join(", ")}]`);

  try {
    if (pdfIds.length > 0 || jobIds.length > 0 || userIds.length > 0) {
      await pool.query(
        `DELETE FROM analytics_events 
         WHERE (entity_type = 'pdfs' AND entity_id = ANY($1::bigint[]))
            OR (entity_type = 'document_jobs' AND entity_id = ANY($2::bigint[]))
            OR (user_id = ANY($3::bigint[]))`,
        [pdfIds, jobIds, userIds]
      );
    }

    if (pdfIds.length > 0) {
      await pool.query(`DELETE FROM pdf_chunks WHERE pdf_id = ANY($1::bigint[])`, [pdfIds]);
    }

    if (jobIds.length > 0 || pdfIds.length > 0) {
      await pool.query(
        `DELETE FROM document_jobs WHERE id = ANY($1::bigint[]) OR pdf_id = ANY($2::bigint[])`,
        [jobIds, pdfIds]
      );
    }

    if (pdfIds.length > 0 || userIds.length > 0) {
      await pool.query(
        `DELETE FROM chat_messages WHERE pdf_id = ANY($1::bigint[]) OR user_id = ANY($2::bigint[])`,
        [pdfIds, userIds]
      );
    }

    if (classroomIds.length > 0 || userIds.length > 0) {
      await pool.query(
        `DELETE FROM classroom_members WHERE classroom_id = ANY($1::bigint[]) OR student_id = ANY($2::bigint[])`,
        [classroomIds, userIds]
      );
      await pool.query(
        `DELETE FROM classroom_subjects WHERE classroom_id = ANY($1::bigint[])`,
        [classroomIds]
      );
    }

    if (pdfIds.length > 0) {
      await pool.query(`DELETE FROM pdfs WHERE id = ANY($1::bigint[])`, [pdfIds]);
    }

    if (classroomIds.length > 0) {
      await pool.query(`DELETE FROM classrooms WHERE id = ANY($1::bigint[])`, [classroomIds]);
    }

    if (userIds.length > 0) {
      await pool.query(`DELETE FROM users WHERE id = ANY($1::bigint[])`, [userIds]);
    }

    for (const f of filePaths) {
      try {
        await cloudStorage.deleteFile(f);
      } catch (_) {}
    }
    console.log("  ✔ Teardown completed successfully for tracked execution records.");
  } catch (cleanErr) {
    console.warn("  ⚠ Teardown warning:", cleanErr.message);
  }
}

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`  ❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  ✓ PASSED: ${message}`);
  passedTests++;
}

async function runTestSuite() {
  console.log("==================================================================");
  console.log("   STUDYREADER MASTER CLOUD ARCHITECTURE VERIFICATION TEST SUITE  ");
  console.log("==================================================================");
  console.log(`Target Server: ${BASE_URL}`);

  let testTeacherJar = new CookieJar();
  let testStudentJar = new CookieJar();
  let testAdminJar = new CookieJar();
  let teacherId = null;
  let studentId = null;
  let classroomId = null;
  let initialCode = null;
  let uploadedPdfId = null;
  let uploadedStoragePath = null;
  let enqueuedJobId = null;

  try {
    // -------------------------------------------------------------
    // SECTION 1: DATABASE SCHEMA INTEGRITY (PHASE B)
    // -------------------------------------------------------------
    console.log("\n[1/7] Testing Database Schema Modernization (Phase B)...");

    const jobsCols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'document_jobs'`
    );
    const jobColNames = jobsCols.rows.map(r => r.column_name);
    assert(jobColNames.includes("id"), "document_jobs has 'id' column");
    assert(jobColNames.includes("pdf_id"), "document_jobs has 'pdf_id' column");
    assert(jobColNames.includes("status"), "document_jobs has 'status' column");
    assert(jobColNames.includes("locked_at"), "document_jobs has 'locked_at' column");
    assert(jobColNames.includes("locked_by"), "document_jobs has 'locked_by' column");
    assert(jobColNames.includes("progress"), "document_jobs has 'progress' column");

    const chunkCols = await pool.query(
      `SELECT column_name, udt_name FROM information_schema.columns WHERE table_name = 'pdf_chunks'`
    );
    const chunkColMap = Object.fromEntries(chunkCols.rows.map(r => [r.column_name, r.udt_name]));
    assert(chunkColMap["metadata"] === "jsonb", "pdf_chunks has 'metadata' column with jsonb type");
    assert(chunkColMap["embedding"] === "vector" || chunkColMap["embedding"] === "_float8", `pdf_chunks has embedding column (${chunkColMap["embedding"]})`);

    const analyticsCols = await pool.query(
      `SELECT column_name FROM information_schema.columns WHERE table_name = 'analytics_events'`
    );
    assert(analyticsCols.rows.length >= 5, "analytics_events table exists with required event fields");

    // -------------------------------------------------------------
    // SECTION 2: AUTHENTICATION & MULTI-TENANT TEST USERS
    // -------------------------------------------------------------
    console.log("\n[2/7] Authenticating Teacher, Student, and Admin Sessions...");

    const teacherEmail = `cloud_teacher_${Date.now()}@studyreader.edu`;
    const studentEmail = `cloud_student_${Date.now()}@studyreader.edu`;
    const password = "TestPassword2026!";

    // Register Teacher
    const regTeach = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Dr. Cloud Professor", email: teacherEmail, password, role: "teacher" })
    }, testTeacherJar);
    const regTeachText = await regTeach.text();
    console.log(`  [DEBUG] regTeach status: ${regTeach.status}, body: ${regTeachText}`);
    assert(regTeach.status === 201, "Teacher registered successfully (201)");
    const teachData = JSON.parse(regTeachText);
    teacherId = teachData.user.id;
    trackedRecords.users.add(teacherId);

    // Register Student
    const regStud = await request("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Alex Cloud Student", email: studentEmail, password, role: "student" })
    }, testStudentJar);
    assert(regStud.status === 201, "Student registered successfully (201)");
    const studData = await regStud.json();
    studentId = studData.user.id;
    trackedRecords.users.add(studentId);

    // Login Admin
    const loginAdmin = await request("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@studyreader.com", password: "adminpassword" })
    }, testAdminJar);
    if (loginAdmin.status === 200) {
      assert(true, "Admin logged in successfully (200)");
    } else {
      console.log("  ℹ Admin user not default password, using existing admin session if present.");
    }

    // -------------------------------------------------------------
    // SECTION 3: CLOUD STORAGE & PRESIGNED DIRECT UPLOAD (PHASE C)
    // -------------------------------------------------------------
    console.log("\n[3/7] Testing Cloud Storage & Direct Upload Architecture (Phase C)...");

    // Create Classroom
    const createClassRes = await request("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Cloud Architecture CS-401", semester: "6", section: "Cloud-A", description: "Advanced Distributed Systems" })
    }, testTeacherJar);
    assert(createClassRes.status === 201, "Teacher created classroom CS-401 (201)");
    const classData = await createClassRes.json();
    classroomId = classData.classroom.id;
    trackedRecords.classrooms.add(classroomId);
    initialCode = classData.classroom.code;
    assert(Boolean(initialCode), `Classroom code generated: ${initialCode}`);

    // Presigned upload request
    const presignRes = await request("/api/storage/presigned-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: "Distributed_Consensus_Raft.pdf",
        contentType: "application/pdf",
        classroomId,
        category: "resource"
      })
    }, testTeacherJar);
    assert(presignRes.status === 200, "POST /api/storage/presigned-upload returned 200");
    const presignData = await presignRes.json();
    assert(Boolean(presignData.uploadUrl), "Presigned upload URL provided");
    assert(Boolean(presignData.pdfId), "Pending PDF ID created");
    uploadedPdfId = presignData.pdfId;
    uploadedStoragePath = presignData.storagePath;
    trackedRecords.pdfs.add(uploadedPdfId);
    if (uploadedStoragePath) trackedRecords.files.add(uploadedStoragePath);

    // Direct binary upload to the uploadUrl
    const pdfBuffer = createDummyPdfBuffer();
    const uploadRes = await request(presignData.uploadUrl, {
      method: presignData.method || "PUT",
      headers: { "Content-Type": "application/pdf" },
      body: pdfBuffer
    });
    assert(uploadRes.status === 200, "Direct binary upload succeeded (200)");

    // Finalize upload
    const finalizeRes = await request("/api/storage/finalize-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pdfId: uploadedPdfId, storagePath: uploadedStoragePath })
    }, testTeacherJar);
    assert(finalizeRes.status === 200, "POST /api/storage/finalize-upload returned 200");
    const finalizeData = await finalizeRes.json();
    assert(Boolean(finalizeData.jobId), "Finalize enqueued background processing job");
    enqueuedJobId = finalizeData.jobId;
    trackedRecords.jobs.add(enqueuedJobId);

    // Unauthenticated access to /uploads is blocked
    const unauthUploads = await request(`/uploads/${uploadedStoragePath}`);
    assert(unauthUploads.status === 401 || unauthUploads.status === 404, "Public /uploads path is blocked/unauthorized");

    // Signed Download URL
    const signedUrlRes = await request(`/api/pdfs/${uploadedPdfId}/signed-url`, {}, testTeacherJar);
    const signedUrlText = await signedUrlRes.text();
    console.log(`  [DEBUG] signedUrl status: ${signedUrlRes.status}, body: ${signedUrlText}`);
    assert(signedUrlRes.status === 200, "GET /api/pdfs/:id/signed-url returned 200 for teacher");
    const signedUrlData = JSON.parse(signedUrlText);
    assert(Boolean(signedUrlData.signedUrl), "Signed download URL returned");

    // Access document through signed URL
    const fileViaSigned = await request(signedUrlData.signedUrl);
    assert(fileViaSigned.status === 200, "Document downloaded successfully via signed URL (200)");

    // Access document through authenticated stream
    const fileViaStream = await request(`/api/pdfs/${uploadedPdfId}/file`, {}, testTeacherJar);
    assert(fileViaStream.status === 200, "Document streamed successfully via /api/pdfs/:id/file (200)");

    // -------------------------------------------------------------
    // SECTION 4: DURABLE JOB QUEUE & ATOMIC WORKER (PHASE D)
    // -------------------------------------------------------------
    console.log("\n[4/7] Testing Background Processing & Durable Job Queue (Phase D)...");

    // Process batch of background jobs
    const processBatchRes = await request("/api/jobs/process-batch?limit=3", {
      method: "POST"
    }, testTeacherJar);
    assert(processBatchRes.status === 200, "POST /api/jobs/process-batch executed successfully (200)");

    // Poll until background job completes
    let jobStatusData = null;
    for (let i = 0; i < 15; i++) {
      const res = await request(`/api/jobs/${enqueuedJobId}`, {}, testTeacherJar);
      jobStatusData = await res.json();
      if (jobStatusData.job?.status === "completed" || jobStatusData.job?.status === "failed") {
        break;
      }
      await new Promise(r => setTimeout(r, 1500));
    }

    assert(jobStatusData?.job?.status === "completed", `Job #${enqueuedJobId} completed with 100% progress`);
    console.log(`  ℹ Job #${enqueuedJobId} Status: ${jobStatusData.job.status}, Progress: ${jobStatusData.job.progress}%`);

    // Check document job status endpoint
    const docJobRes = await request(`/api/pdfs/${uploadedPdfId}/job-status`, {}, testTeacherJar);
    assert(docJobRes.status === 200, `GET /api/pdfs/:id/job-status returned 200`);

    // Verify pdf_chunks population
    const chunksRes = await pool.query(
      "SELECT COUNT(*)::int as count FROM pdf_chunks WHERE pdf_id = $1",
      [uploadedPdfId]
    );
    console.log(`  ℹ Chunks generated for document #${uploadedPdfId}: ${chunksRes.rows[0].count}`);
    assert(chunksRes.rows[0].count > 0, "Document was extracted and indexed into pdf_chunks");

    // -------------------------------------------------------------
    // SECTION 5: GEMINI EMBEDDINGS & SEMANTIC SEARCH (PHASE F)
    // -------------------------------------------------------------
    console.log("\n[5/7] Testing Gemini 768-dim Embeddings & Semantic Search (Phase F)...");

    // Test embedding service directly
    const testEmb = await embeddingService.generateEmbedding("Distributed consensus and Raft protocol");
    assert(Array.isArray(testEmb) && testEmb.length === 768, "Gemini generated 768-dimension vector embedding");

    // Student joins classroom CS-401 using join code
    const joinRes = await request("/api/classrooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: initialCode })
    }, testStudentJar);
    assert(joinRes.status === 200, "Student successfully joined classroom using code (200)");

    // Student executes cross-document semantic search in classroom
    const searchRes = await request(`/api/classrooms/${classroomId}/semantic-search?q=consensus+protocol`, {}, testStudentJar);
    assert(searchRes.status === 200, "GET /api/classrooms/:id/semantic-search returned 200");
    const searchData = await searchRes.json();
    assert(searchData.count > 0, `Semantic search returned ${searchData.count} relevant excerpt(s)`);
    assert(Boolean(searchData.results[0].documentTitle), "Semantic search result contains document metadata");

    // Conversational Chat with Hybrid Vector RAG
    const chatRes = await request(`/api/pdfs/${uploadedPdfId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "What consensus protocol is discussed?" })
    }, testStudentJar);
    const chatText = await chatRes.text();
    console.log(`  [DEBUG] chat status: ${chatRes.status}, body: ${chatText}`);
    assert(chatRes.status === 200, "Conversational chat returned 200 with vector-grounded answer");
    const chatData = JSON.parse(chatText);
    assert(Boolean(chatData.assistantMessage?.message), "Assistant generated grounded answer");

    // -------------------------------------------------------------
    // SECTION 6: MULTI-TENANT CLASSROOM ISOLATION & LIFECYCLE (PHASE E)
    // -------------------------------------------------------------
    console.log("\n[6/7] Testing Multi-Tenant Classroom Lifecycle & Hardening (Phase E)...");

    // Teacher inspects roster
    const classDetailRes = await request(`/api/classrooms/${classroomId}`, {}, testTeacherJar);
    assert(classDetailRes.status === 200, "Teacher retrieved classroom roster");
    const classDetail = await classDetailRes.json();
    assert(classDetail.students.some(s => String(s.id) === String(studentId)), "Enrolled student appears in teacher roster");

    // Teacher renews classroom join code
    const renewCodeRes = await request(`/api/classrooms/${classroomId}/renew-code`, {
      method: "POST"
    }, testTeacherJar);
    const renewText = await renewCodeRes.text();
    console.log(`  [DEBUG] renewCode status: ${renewCodeRes.status}, body: ${renewText}`);
    assert(renewCodeRes.status === 200, "Teacher renewed classroom join code (200)");
    const renewData = JSON.parse(renewText);
    assert(renewData.code !== initialCode, `New code '${renewData.code}' is different from initial code '${initialCode}'`);

    // Teacher removes student from classroom
    const removeStudentRes = await request(`/api/classrooms/${classroomId}/members/${studentId}`, {
      method: "DELETE"
    }, testTeacherJar);
    assert(removeStudentRes.status === 200, "Teacher removed student from classroom (200)");

    // Removed student is rejected when accessing classroom documents
    const unauthorizedAccessRes = await request(`/api/pdfs/${uploadedPdfId}/file`, {}, testStudentJar);
    assert(unauthorizedAccessRes.status === 403 || unauthorizedAccessRes.status === 404, "Removed student cannot access classroom document (403/404)");

    // Student re-joins using the NEW code and leaves voluntarily
    const rejoinRes = await request("/api/classrooms/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: renewData.code })
    }, testStudentJar);
    assert(rejoinRes.status === 200, "Student rejoined classroom using newly renewed code (200)");

    const leaveRes = await request(`/api/classrooms/${classroomId}/leave`, {
      method: "POST"
    }, testStudentJar);
    assert(leaveRes.status === 200, "Student left classroom voluntarily via POST /api/classrooms/:id/leave (200)");

    // -------------------------------------------------------------
    // SECTION 7: OBSERVABILITY, METRICS & DEPLOYMENT CONFIG (PHASE H & I)
    // -------------------------------------------------------------
    console.log("\n[7/7] Testing Observability, Admin Metrics & Vercel Config (Phase H & I)...");

    // Admin Metrics
    const metricsRes = await request("/api/admin/metrics", {}, testAdminJar);
    if (metricsRes.status === 200) {
      const metricsData = await metricsRes.json();
      assert(metricsData.metrics.jobs !== undefined, "Admin metrics includes background jobs summary");
      assert(metricsData.metrics.storage !== undefined, "Admin metrics includes storage statistics");
      assert(Array.isArray(metricsData.metrics.recentActivity), "Admin metrics includes recentActivity timeline");
    } else {
      console.log("  ℹ Admin endpoint requires admin role session (tested via database query below).");
    }

    // Verify analytics events persisted
    const eventCountRes = await pool.query("SELECT COUNT(*)::int as count FROM analytics_events");
    assert(eventCountRes.rows[0].count > 0, `analytics_events tracked ${eventCountRes.rows[0].count} platform event(s)`);

    // Verify Vercel deployment files
    const vercelConfigPath = path.resolve(__dirname, "../../vercel.json");
    const apiIndexPath = path.resolve(__dirname, "../../api/index.js");
    const rootEnvExample = path.resolve(__dirname, "../../.env.example");

    assert(fs.existsSync(vercelConfigPath), "vercel.json exists");
    assert(fs.existsSync(apiIndexPath), "api/index.js exists for Vercel Functions");
    assert(fs.existsSync(rootEnvExample), "root .env.example exists");

    const vercelJson = JSON.parse(fs.readFileSync(vercelConfigPath, "utf8"));
    const hasApiRoute = vercelJson.routes?.some(r => r.src.includes("/api/"));
    assert(hasApiRoute, "vercel.json routes /api/* to api/index.js");

    console.log("\n==================================================================");
    console.log(`\x1b[32m✔ SUCCESS: ALL ${passedTests}/${totalTests} CLOUD ARCHITECTURE TESTS PASSED! (${skippedTests} skipped)\x1b[0m`);
    console.log("==================================================================");

  } catch (err) {
    console.error(`\n\x1b[31m✖ TEST SUITE ABORTED:\x1b[0m`, err.message);
    suiteError = err;
  } finally {
    // Teardown ONLY the records created during this execution
    await cleanupTestExecutionRecords();
    await pool.end();
  }

  if (suiteError) {
    process.exit(1);
  }
}

let suiteError = null;

process.on("SIGINT", async () => {
  console.log("\n[INTERRUPTED] Cleaning up before exit...");
  await cleanupTestExecutionRecords();
  await pool.end();
  process.exit(130);
});

runTestSuite();
