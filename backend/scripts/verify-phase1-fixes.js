/**
 * verify-phase1-fixes.js
 * Comprehensive automated verification for StudyReader Phase 1:
 * Critical Bug Fixes & Functional Stabilization
 *
 * 1. Teacher Dashboard Roster (DOM & Classroom API)
 * 2. Duplicate Upload Handling (Frontend API surface & Backend duplicate workflow)
 * 3. Read Aloud Audio Cleanup (DOM hooks & SpeechSynthesis cancellation)
 * 4. Gemini Error Handling (No mock fallbacks, explicit errors on missing key/failures)
 * 5. General Regression Testing
 */

const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const ragService = require("../services/ai/rag-service");
const academicTutor = require("../services/ai/academic-tutor");

const BASE_URL = process.env.BACKEND_URL || "http://127.0.0.1:3000";

let testPassed = 0;
let testFailed = 0;

function assert(condition, message) {
  if (condition) {
    testPassed++;
    console.log(`  ✓ PASS: ${message}`);
  } else {
    testFailed++;
    console.error(`  ✗ FAIL: ${message}`);
  }
}

function extractCookie(res) {
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")];
  if (!setCookie || setCookie.length === 0 || !setCookie[0]) return "";
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function requestJson(method, reqPath, cookie = "", body = null) {
  const headers = {};
  if (cookie) headers["Cookie"] = cookie;
  const opts = { method, headers };

  if (body) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch(`${BASE_URL}${reqPath}`, opts);
  const cookieHeader = extractCookie(res);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  return {
    status: res.status,
    cookie: cookieHeader,
    data
  };
}

async function uploadFile(reqPath, cookie = "", filename, fileContent, extraFields = {}) {
  const fd = new FormData();
  fd.append("pdf", new Blob([fileContent], { type: "text/plain" }), filename);
  for (const [k, v] of Object.entries(extraFields)) {
    fd.append(k, v);
  }

  const headers = {};
  if (cookie) headers["Cookie"] = cookie;

  const res = await fetch(`${BASE_URL}${reqPath}`, {
    method: "POST",
    headers,
    body: fd
  });

  const cookieHeader = extractCookie(res);
  let data = null;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  return {
    status: res.status,
    cookie: cookieHeader,
    data
  };
}

async function runVerification() {
  console.log("================================================================================");
  console.log("   STUDYREADER — PHASE 1: COMPREHENSIVE AUTOMATED VERIFICATION SUITE");
  console.log("================================================================================\n");

  const timestamp = Date.now();
  const teacherEmail = `phase1_teacher_${timestamp}@test.edu`;
  const studentEmail = `phase1_student_${timestamp}@test.edu`;
  const intruderEmail = `phase1_intruder_${timestamp}@test.edu`;
  const otherStudentEmail = `phase1_other_${timestamp}@test.edu`;
  const password = "Password123!";

  let teacherCookie = "";
  let studentCookie = "";
  let intruderCookie = "";
  let otherStudentCookie = "";
  let testClassroomId = null;
  let testClassCode = null;
  let testPdfId = null;

  try {
    // ==========================================================================
    // 1. TEACHER DASHBOARD ROSTER VERIFICATION
    // ==========================================================================
    console.log("--- 1. TEACHER DASHBOARD ROSTER VERIFICATION ---");

    // 1.1 DOM Code & ID matching check
    const teacherHtmlPath = path.resolve(__dirname, "../../frontend/pages/teacher-dashboard/index.html");
    const teacherJsPath = path.resolve(__dirname, "../../frontend/pages/teacher-dashboard/teacher-dashboard.js");
    const teacherHtml = fs.readFileSync(teacherHtmlPath, "utf8");
    const teacherJs = fs.readFileSync(teacherJsPath, "utf8");

    assert(teacherHtml.includes('id="roster-class-code"'), "index.html defines id='roster-class-code'");
    assert(teacherHtml.includes('id="roster-students-list"'), "index.html defines id='roster-students-list'");
    assert(teacherHtml.includes('id="roster-table"'), "index.html defines id='roster-table'");
    assert(teacherHtml.includes('id="roster-empty"'), "index.html defines id='roster-empty'");

    assert(teacherJs.includes('document.getElementById("roster-class-code")'), "teacher-dashboard.js queries 'roster-class-code'");
    assert(teacherJs.includes('document.getElementById("roster-students-list")'), "teacher-dashboard.js queries 'roster-students-list'");
    assert(teacherJs.includes('document.getElementById("roster-table")'), "teacher-dashboard.js queries 'roster-table'");
    assert(teacherJs.includes('document.getElementById("roster-empty")'), "teacher-dashboard.js queries 'roster-empty'");

    assert(!teacherJs.includes("roster-class-meta"), "teacher-dashboard.js has NO reference to broken 'roster-class-meta'");
    assert(!teacherJs.includes("roster-table-body"), "teacher-dashboard.js has NO reference to broken 'roster-table-body'");
    assert(teacherJs.includes('rosterTable.style.display = "table"'), "teacher-dashboard.js unhides table with display = 'table'");

    // 1.2 Setup accounts for Classroom API testing
    const teacherSignup = await requestJson("POST", "/api/auth/signup", "", {
      name: "Prof. Sarah Connor",
      email: teacherEmail,
      password: password,
      role: "teacher"
    });
    assert(teacherSignup.status === 201, `Teacher account created (${teacherEmail})`);
    teacherCookie = teacherSignup.cookie;

    const studentSignup = await requestJson("POST", "/api/auth/signup", "", {
      name: "John Connor",
      email: studentEmail,
      password: password,
      role: "student"
    });
    assert(studentSignup.status === 201, `Student account created (${studentEmail})`);
    studentCookie = studentSignup.cookie;

    const intruderSignup = await requestJson("POST", "/api/auth/signup", "", {
      name: "T-800",
      email: intruderEmail,
      password: password,
      role: "teacher"
    });
    assert(intruderSignup.status === 201, `Intruder teacher account created (${intruderEmail})`);
    intruderCookie = intruderSignup.cookie;

    // 1.3 Create classroom
    const createClassRes = await requestJson("POST", "/api/classrooms", teacherCookie, {
      name: "HCI & UI Design - Fall 2026",
      subject: "Human-Computer Interaction",
      section: "Sec A",
      description: "Advanced interaction patterns"
    });
    assert(createClassRes.status === 201, "Teacher created classroom successfully");
    testClassroomId = createClassRes.data?.classroom?.id;
    testClassCode = createClassRes.data?.classroom?.code;

    // 1.4 Test Empty Classroom Roster
    const emptyRosterRes = await requestJson("GET", `/api/classrooms/${testClassroomId}`, teacherCookie);
    assert(emptyRosterRes.status === 200, "Teacher fetched classroom details (empty state)");
    assert(Array.isArray(emptyRosterRes.data?.students) && emptyRosterRes.data.students.length === 0,
      "Classroom students list is empty array [] when no students enrolled");

    // 1.5 Student joins classroom
    const joinRes = await requestJson("POST", "/api/classrooms/join", studentCookie, {
      code: testClassCode
    });
    assert(joinRes.status === 200, "Student joined classroom successfully");

    // 1.6 Teacher fetches classroom details with enrolled student
    const populatedRosterRes = await requestJson("GET", `/api/classrooms/${testClassroomId}`, teacherCookie);
    assert(populatedRosterRes.status === 200, "Teacher fetched classroom details with enrolled student");
    assert(Array.isArray(populatedRosterRes.data?.students) && populatedRosterRes.data.students.length === 1,
      "Classroom students array contains exactly 1 student");
    const studentEntry = populatedRosterRes.data.students[0];
    assert(studentEntry.name === "John Connor", "Enrolled student name matches 'John Connor'");
    assert(studentEntry.email === studentEmail, "Enrolled student email matches");
    assert(Boolean(studentEntry.joinedAt || studentEntry.enrolledAt), "Enrolled student has valid enrollment timestamp");

    // 1.7 Security check: Intruder teacher cannot view another teacher's classroom
    const unauthorizedRes = await requestJson("GET", `/api/classrooms/${testClassroomId}`, intruderCookie);
    assert(unauthorizedRes.status === 403, "Non-owner teacher receives 403 Forbidden accessing classroom");

    // 1.8 Security check: Non-member student receives 403 Forbidden
    const otherStudent = await requestJson("POST", "/api/auth/signup", "", {
      name: "Random Student",
      email: otherStudentEmail,
      password: password,
      role: "student"
    });
    otherStudentCookie = otherStudent.cookie;
    const unjoinedStudentRes = await requestJson("GET", `/api/classrooms/${testClassroomId}`, otherStudentCookie);
    assert(unjoinedStudentRes.status === 403, "Non-enrolled student receives 403 Forbidden");

    // ==========================================================================
    // 2. DUPLICATE UPLOAD HANDLING VERIFICATION
    // ==========================================================================
    console.log("\n--- 2. DUPLICATE UPLOAD HANDLING VERIFICATION ---");

    // 2.1 Check frontend duplicate-upload.js surface
    const dupJsPath = path.resolve(__dirname, "../../frontend/scripts/duplicate-upload.js");
    const dupJs = fs.readFileSync(dupJsPath, "utf8");

    assert(dupJs.includes("window.StudyReaderDuplicateUpload = {"), "duplicate-upload.js exports window.StudyReaderDuplicateUpload");
    assert(dupJs.includes("open: handleOpen"), "window.StudyReaderDuplicateUpload exports 'open'");
    assert(dupJs.includes("show: handleOpen"), "window.StudyReaderDuplicateUpload exports 'show'");
    assert(dupJs.includes("if (dialog.open)"), "Duplicate dialog prevents multiple concurrent instances");
    assert(dupJs.includes("onCancelCallback"), "Handles onCancel callback properly");
    assert(dupJs.includes('dialog.addEventListener("cancel"'), "Handles native Escape/cancel event");

    // 2.2 API Workflow: First Upload
    const testFileName = `phase1_test_${timestamp}.pdf`;
    const minimalPdf = `%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/MediaBox[0 0 612 792]/Parent 2 0 R/Resources<<>>>>endobj\nxref\n0 4\n0000000000 65535 f\n0000000010 00000 n\n0000000057 00000 n\n0000000115 00000 n\ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n200\n%%EOF`;
    const firstUploadRes = await uploadFile("/api/pdfs/upload", studentCookie, testFileName, minimalPdf, {
      category: "resource"
    });
    assert(firstUploadRes.status === 201, `Initial document uploaded (${testFileName})`);
    assert(firstUploadRes.data?.duplicate === false, "First upload duplicate flag is false");
    testPdfId = firstUploadRes.data?.pdf?.id;
    assert(Boolean(testPdfId), `PDF created with ID ${testPdfId}`);

    // 2.3 API Workflow: Duplicate Upload Detected (409 Conflict)
    const dupUploadRes = await uploadFile("/api/pdfs/upload", studentCookie, testFileName, minimalPdf, {
      category: "resource"
    });
    assert(dupUploadRes.status === 409, "Duplicate upload returned HTTP 409 Conflict");
    assert(dupUploadRes.data?.duplicate === true, "Duplicate upload response has duplicate: true");
    assert(Boolean(dupUploadRes.data?.pendingUpload?.filename), "pendingUpload.filename is returned");
    assert(dupUploadRes.data?.existingPdf?.id === testPdfId, "existingPdf.id matches existing document");

    const pendingFilename = dupUploadRes.data.pendingUpload.filename;

    // 2.4 API Workflow: Duplicate Cancel
    const cancelRes = await requestJson("POST", "/api/pdfs/duplicate/cancel", studentCookie, {
      filename: pendingFilename
    });
    assert(cancelRes.status === 200, "POST /api/pdfs/duplicate/cancel returns 200 OK");
    assert(cancelRes.data?.success === true, "Duplicate upload cancelled successfully");

    // Re-verify staging file removed: trying to cancel again should 404
    const repeatCancelRes = await requestJson("POST", "/api/pdfs/duplicate/cancel", studentCookie, {
      filename: pendingFilename
    });
    assert(repeatCancelRes.status === 404, "Subsequent cancel returns 404 (staging file was cleaned up)");

    // 2.5 API Workflow: Duplicate Keep Both
    const dupUpload2 = await uploadFile("/api/pdfs/upload", studentCookie, testFileName, minimalPdf, {
      category: "resource"
    });
    assert(dupUpload2.status === 409, "Duplicate upload 2 returned 409");
    const pendingFilename2 = dupUpload2.data.pendingUpload.filename;

    const keepBothRes = await requestJson("POST", "/api/pdfs/duplicate/keep-both", studentCookie, {
      filename: pendingFilename2
    });
    assert(keepBothRes.status === 201, "POST /api/pdfs/duplicate/keep-both returns 201 Created");
    assert(Boolean(keepBothRes.data?.pdf?.id), "New document ID created via keep-both");
    const keepBothPdfId = keepBothRes.data.pdf.id;
    assert(keepBothPdfId !== testPdfId, "Keep-both created a distinct PDF ID");

    // Clean up keep-both doc
    await requestJson("DELETE", `/api/pdfs/${keepBothPdfId}`, studentCookie);

    // 2.6 API Workflow: Duplicate Replace Existing
    const dupUpload3 = await uploadFile("/api/pdfs/upload", studentCookie, testFileName, minimalPdf, {
      category: "resource"
    });
    assert(dupUpload3.status === 409, "Duplicate upload 3 returned 409");
    const pendingFilename3 = dupUpload3.data.pendingUpload.filename;

    const replaceRes = await requestJson("POST", "/api/pdfs/duplicate/replace", studentCookie, {
      filename: pendingFilename3,
      existingPdfId: testPdfId
    });
    assert(replaceRes.status === 200, "POST /api/pdfs/duplicate/replace returns 200 OK");
    assert(replaceRes.data?.pdf?.id === testPdfId, "Replaced PDF maintained same ID");

    // Clean up test document
    await requestJson("DELETE", `/api/pdfs/${testPdfId}`, studentCookie);

    // ==========================================================================
    // 3. READ ALOUD AUDIO CLEANUP VERIFICATION
    // ==========================================================================
    console.log("\n--- 3. READ ALOUD AUDIO CLEANUP VERIFICATION ---");

    const pdfStudyJsPath = path.resolve(__dirname, "../../frontend/pages/pdf-study/pdf-study.js");
    const pdfStudyJs = fs.readFileSync(pdfStudyJsPath, "utf8");
    const readAloudJsPath = path.resolve(__dirname, "../../frontend/scripts/read-aloud.js");
    const readAloudJs = fs.readFileSync(readAloudJsPath, "utf8");

    // 3.1 Function definition checks
    assert(pdfStudyJs.includes("function stopAllSpeechAudio() {"), "stopAllSpeechAudio() function is defined in pdf-study.js");
    assert(pdfStudyJs.includes("window.speechSynthesis.cancel()"), "stopAllSpeechAudio() calls window.speechSynthesis.cancel()");
    assert(pdfStudyJs.includes("window.StudyReaderReadAloud.stop()"), "stopAllSpeechAudio() calls window.StudyReaderReadAloud.stop()");
    assert(pdfStudyJs.includes("activeSpeechState = {"), "stopAllSpeechAudio() resets activeSpeechState");
    assert(pdfStudyJs.includes('readAloudPanel.style.display = "none"'), "stopAllSpeechAudio() hides readAloudPanel");

    // 3.2 Navigation and switch hook checks
    assert(pdfStudyJs.includes("async function openDocument(id, updateHistory = true) {\n  if (!id) return;\n  stopAllSpeechAudio();"),
      "openDocument() immediately invokes stopAllSpeechAudio()");
    assert(pdfStudyJs.includes("async function loadSelectedPDF() {\n  stopAllSpeechAudio();"),
      "loadSelectedPDF() immediately invokes stopAllSpeechAudio()");
    assert(pdfStudyJs.includes("function showEmptySelectionState() {\n  stopAllSpeechAudio();"),
      "showEmptySelectionState() invokes stopAllSpeechAudio()");
    assert(pdfStudyJs.includes("async function openLibraryPicker() {\n  stopAllSpeechAudio();"),
      "openLibraryPicker() invokes stopAllSpeechAudio()");
    assert(pdfStudyJs.includes('window.addEventListener("popstate"'),
      "popstate event listener registered for browser back/forward");
    assert(pdfStudyJs.includes('window.addEventListener("beforeunload"'),
      "beforeunload event listener registered to stop audio on tab/window navigation");
    assert(pdfStudyJs.includes('window.addEventListener("pagehide"'),
      "pagehide event listener registered for mobile/browser navigation");
    assert(pdfStudyJs.includes('backToLibrary.addEventListener("click"'),
      "backToLibrary click handler registered with stopAllSpeechAudio()");

    // 3.3 StudyReaderReadAloud.stop check
    assert(readAloudJs.includes("window.StudyReaderReadAloud = {"), "read-aloud.js exports window.StudyReaderReadAloud");
    assert(readAloudJs.includes("stopCurrentPlayback()"), "StudyReaderReadAloud.stop calls stopCurrentPlayback()");
    assert(readAloudJs.includes("state.playing = false;"), "StudyReaderReadAloud resets playing state");
    assert(readAloudJs.includes("state.paused = false;"), "StudyReaderReadAloud resets paused state");

    // ==========================================================================
    // 4. GEMINI ERROR HANDLING (NO HARDCODED REPLIES) VERIFICATION
    // ==========================================================================
    console.log("\n--- 4. GEMINI ERROR HANDLING VERIFICATION ---");

    // 4.1 Mock answer generator throws explicit error
    let mockErrorThrown = false;
    try {
      academicTutor.generateAcademicTeachingResponse({
        mode: "ask-ai",
        question: "What is an agent?",
        text: "Sample text"
      });
    } catch (err) {
      mockErrorThrown = true;
      assert(err.message.includes("disabled"), `academicTutor throws error: "${err.message}"`);
    }
    assert(mockErrorThrown, "academicTutor.generateAcademicTeachingResponse throws error prohibiting mock responses");

    // 4.2 Missing API Key triggers clear explicit error
    let missingKeyError = false;
    try {
      await ragService.callGeminiApi({
        apiKey: "",
        model: "gemini-3.5-flash-lite",
        systemInstruction: "You are a teacher.",
        userPrompt: "Hello"
      });
    } catch (err) {
      missingKeyError = true;
      assert(err.message.includes("GEMINI_API_KEY is not configured"),
        `callGeminiApi with empty key throws: "${err.message}"`);
    }
    assert(missingKeyError, "Missing GEMINI_API_KEY throws explicit error, never falls back to mock answers");

    // 4.3 Invalid API key test
    let invalidKeyError = false;
    try {
      await ragService.callGeminiApi({
        apiKey: "AIzaSyFAKE_INVALID_KEY_1234567890",
        model: "gemini-3.5-flash-lite",
        systemInstruction: "You are a teacher.",
        userPrompt: "Hello"
      });
    } catch (err) {
      invalidKeyError = true;
      assert(err.message.length > 0, `Invalid API key cleanly rejected with error: "${err.message.slice(0, 80)}..."`);
    }
    assert(invalidKeyError, "Invalid Gemini API key cleanly throws without mock fallback");

    // 4.4 Verify backend server code does NOT call disabled mock tutor
    const serverJsPath = path.resolve(__dirname, "../server.js");
    const serverJs = fs.readFileSync(serverJsPath, "utf8");
    assert(!serverJs.includes("generateAcademicTeachingResponse"),
      "backend/server.js does NOT call generateAcademicTeachingResponse");
    assert(serverJs.includes("ragService.answer"),
      "backend/server.js routes questions through ragService.answer");

    // 4.5 Live Gemini call on real document grounded text
    console.log("  Testing live Gemini response on general academic document snippet...");
    const generalDocText = `
Physics Lecture Notes: Optics and Wave Phenomena
Refraction is the change in direction of a wave passing from one medium to another or from a gradual change in the medium. Refraction of light is the most commonly observed phenomenon, but other waves such as sound waves and water waves also experience refraction.
Snell's Law: n1 * sin(theta1) = n2 * sin(theta2), where n is the refractive index.
    `;
    const geminiRes = await ragService.answer({
      mode: "ask-ai",
      question: "What is refraction according to this document?",
      text: generalDocText,
      history: []
    });
    assert(geminiRes.provider === "gemini", `Provider is '${geminiRes.provider}'`);
    assert(typeof geminiRes.answer === "string" && geminiRes.answer.length > 20, "Gemini returned non-empty answer");
    const ansLower = geminiRes.answer.toLowerCase();
    assert(ansLower.includes("wave") || ansLower.includes("medium") || ansLower.includes("direction"),
      "Gemini answer is grounded in the physics optics text");
    assert(!ansLower.includes("agent") && !ansLower.includes("actuator") && !ansLower.includes("thermostat"),
      "Gemini answer contains NO Intelligent Agents hardcoded text");

    // ==========================================================================
    // 5. REGRESSION TESTING FOR CORE ENDPOINTS
    // ==========================================================================
    console.log("\n--- 5. REGRESSION TESTING CORE ENDPOINTS ---");

    // 5.1 GET /api/auth/me (authenticated)
    const meRes = await requestJson("GET", "/api/auth/me", teacherCookie);
    assert(meRes.status === 200, "GET /api/auth/me returns 200 for authenticated user");
    assert(meRes.data?.user?.email === teacherEmail, "GET /api/auth/me returns correct user profile");

    // 5.2 GET /api/auth/me (unauthenticated)
    const unauthMeRes = await requestJson("GET", "/api/auth/me");
    assert(unauthMeRes.status === 401, "GET /api/auth/me returns 401 for unauthenticated user");

    // 5.3 GET /api/pdfs (authenticated)
    const pdfsRes = await requestJson("GET", "/api/pdfs", teacherCookie);
    assert(pdfsRes.status === 200, "GET /api/pdfs returns 200 OK");
    assert(Array.isArray(pdfsRes.data?.pdfs), "GET /api/pdfs returns pdfs array");

    // 5.4 GET /api/classrooms (authenticated)
    const classroomsRes = await requestJson("GET", "/api/classrooms", teacherCookie);
    assert(classroomsRes.status === 200, "GET /api/classrooms returns 200 OK");
    assert(Array.isArray(classroomsRes.data?.classrooms), "GET /api/classrooms returns classrooms array");

    // Clean up test classroom
    if (testClassroomId) {
      await requestJson("DELETE", `/api/classrooms/${testClassroomId}`, teacherCookie);
    }

  } catch (error) {
    console.error("FATAL SUITE ERROR:", error);
    testFailed++;
  }

  console.log("\n================================================================================");
  console.log(`VERIFICATION SUMMARY: ${testPassed} Passed, ${testFailed} Failed`);
  console.log("================================================================================");

  if (testFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runVerification();
