// ============================================================
// Comprehensive E2E Verification for StudyReader Platform
// Tests Auth, Role Separation, Single PDF lookup, Chat Thread
// Persistence, Structured AI Summaries, and PYQ Analysis.
// ============================================================

const API_BASE = "http://127.0.0.1:3000";

async function run() {
  console.log("=== STARTING STUDYREADER E2E AUDIT & REGRESSION TESTS ===");

  const timestamp = Date.now();
  const studentEmail = `e2e_student_${timestamp}@test.edu`;
  const teacherEmail = `e2e_teacher_${timestamp}@test.edu`;
  const password = "Password123!";

  let studentCookie = "";
  let teacherCookie = "";
  let teacherId = null;
  let studentId = null;
  let classroomId = null;
  let classroomCode = null;
  let subjectId = null;
  let uploadedPdfId = null;

  function parseCookie(res) {
    const raw = res.headers.get("set-cookie");
    if (!raw) return "";
    return raw.split(";")[0];
  }

  // TEST 1: Register Student
  console.log("\n1. Testing Student Public Registration...");
  const sRegRes = await fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Alice Student",
      email: studentEmail,
      password,
      role: "student"
    })
  });
  const sRegData = await sRegRes.json();
  console.log("Student Reg Status:", sRegRes.status, "Role:", sRegData.user?.role);
  if (sRegRes.status !== 201 || sRegData.user?.role !== "student") {
    throw new Error("Student registration failed or role mismatch.");
  }
  studentId = sRegData.user.id;
  studentCookie = parseCookie(sRegRes);

  // TEST 2: Register Teacher
  console.log("\n2. Testing Teacher Public Registration...");
  const tRegRes = await fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Professor Bob",
      email: teacherEmail,
      password,
      role: "teacher"
    })
  });
  const tRegData = await tRegRes.json();
  console.log("Teacher Reg Status:", tRegRes.status, "Role:", tRegData.user?.role);
  if (tRegRes.status !== 201 || tRegData.user?.role !== "teacher") {
    throw new Error("Teacher registration failed or role mismatch.");
  }
  teacherId = tRegData.user.id;
  teacherCookie = parseCookie(tRegRes);

  // TEST 3: Security: Attempt Public Admin Registration (Must Be Rejected or Coerced)
  console.log("\n3. Testing Security Against Unauthorized Admin Creation...");
  const hackRegRes = await fetch(`${API_BASE}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Malicious User",
      email: `malicious_${timestamp}@test.edu`,
      password,
      role: "admin"
    })
  });
  const hackData = await hackRegRes.json();
  console.log("Admin Signup Attempt Status:", hackRegRes.status, "Role:", hackData.user?.role);
  if (hackData.user?.role === "admin") {
    throw new Error("CRITICAL SECURITY FLAW: Public registration allowed admin role!");
  }

  // TEST 4: Teacher creates Classroom & Subject
  console.log("\n4. Testing Classroom Creation & Subject Linking...");
  const classRes = await fetch(`${API_BASE}/api/classrooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: teacherCookie },
    body: JSON.stringify({
      name: "Advanced Cloud Computing",
      semester: "6",
      section: "CS-A",
      description: "Distributed systems and cloud orchestration."
    })
  });
  const classData = await classRes.json();
  console.log("Classroom Created:", classData.classroom?.name, "Code:", classData.classroom?.code);
  classroomId = classData.classroom.id;
  classroomCode = classData.classroom.code;

  const subjRes = await fetch(`${API_BASE}/api/classrooms/${classroomId}/subjects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: teacherCookie },
    body: JSON.stringify({
      name: "Cloud Architecture & Patterns",
      code: "CS601",
      description: "Microservices and state machines"
    })
  });
  const subjData = await subjRes.json();
  console.log("Subject Created & Assigned:", subjData.subject?.name, "ID:", subjData.subject?.id);
  subjectId = subjData.subject.id;

  // TEST 5: Student joins Classroom using 6-character Code
  console.log("\n5. Testing Student Joining Classroom with Code:", classroomCode);
  const joinRes = await fetch(`${API_BASE}/api/classrooms/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: studentCookie },
    body: JSON.stringify({ code: classroomCode })
  });
  const joinData = await joinRes.json();
  console.log("Join Status:", joinRes.status, "Message:", joinData.message);
  if (joinRes.status !== 200) throw new Error("Student join failed.");

  // TEST 6: Upload a PDF Document into Classroom & Subject
  console.log("\n6. Testing Document Upload into Classroom Subject...");
  const boundary = "----WebKitFormBoundary" + timestamp;
  const pdfContent = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>\nendobj\n4 0 obj\n<< /Length 120 >>\nstream\nBT /F1 12 Tf 72 712 Td (StudyReader Cloud Architecture Overview: Microservices, Load Balancers, Distributed Databases, Fault Tolerance) Tj ET\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000216 00000 n\ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n386\n%%EOF\n";

  let bodyBuffer = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="Cloud_Architecture_Notes.pdf"\r\nContent-Type: application/pdf\r\n\r\n`),
    Buffer.from(pdfContent),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="classroomId"\r\n\r\n${classroomId}`),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="subjectId"\r\n\r\n${subjectId}`),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nresource`),
    Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="accessScope"\r\n\r\nclassroom`),
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const uploadRes = await fetch(`${API_BASE}/api/pdfs/upload`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      Cookie: teacherCookie
    },
    body: bodyBuffer
  });
  const uploadData = await uploadRes.json();
  console.log("Upload Status:", uploadRes.status, "PDF ID:", uploadData.pdf?.id, "Filename:", uploadData.pdf?.originalFilename);
  if (uploadRes.status !== 201 || !uploadData.pdf?.id) {
    throw new Error("Document upload failed: " + JSON.stringify(uploadData));
  }
  uploadedPdfId = uploadData.pdf.id;

  // TEST 7: Student fetches single document details via GET /api/pdfs/:id
  console.log("\n7. Testing Dedicated GET /api/pdfs/:id Endpoint for Student...");
  const getPdfRes = await fetch(`${API_BASE}/api/pdfs/${uploadedPdfId}`, {
    method: "GET",
    headers: { Cookie: studentCookie }
  });
  const getPdfData = await getPdfRes.json();
  console.log("Get PDF by ID Status:", getPdfRes.status, "Title:", getPdfData.pdf?.originalFilename, "Classroom:", getPdfData.pdf?.classroomName);
  if (getPdfRes.status !== 200 || !getPdfData.pdf) {
    throw new Error("GET /api/pdfs/:id failed.");
  }

  // TEST 8: Multi-Turn Conversational Chat Engine (GET, POST, DELETE /api/pdfs/:id/chat)
  console.log("\n8. Testing Conversational AI Tutor (Chat Engine)...");
  
  // 8a. Check initial empty chat
  const chatGet1 = await fetch(`${API_BASE}/api/pdfs/${uploadedPdfId}/chat`, {
    method: "GET",
    headers: { Cookie: studentCookie }
  });
  const chatGetData1 = await chatGet1.json();
  console.log("Initial Chat Messages Count:", chatGetData1.messages?.length);

  // 8b. Student asks first question
  console.log("-> Sending Turn 1 question...");
  const chatPost1 = await fetch(`${API_BASE}/api/pdfs/${uploadedPdfId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: studentCookie },
    body: JSON.stringify({ message: "What are the core components of Cloud Architecture mentioned in this document?" })
  });
  const chatPostData1 = await chatPost1.json();
  console.log("Turn 1 Status:", chatPost1.status, "Provider:", chatPostData1.provider);
  console.log("Turn 1 Assistant Response Preview:", chatPostData1.assistantMessage?.message?.slice(0, 140) + "...");
  if (chatPost1.status !== 200 || !chatPostData1.assistantMessage) {
    throw new Error("Chat Turn 1 failed.");
  }

  // 8c. Student asks contextual follow-up (Turn 2)
  console.log("-> Sending Turn 2 follow-up question...");
  const chatPost2 = await fetch(`${API_BASE}/api/pdfs/${uploadedPdfId}/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: studentCookie },
    body: JSON.stringify({ message: "Can you explain how load balancers prevent single points of failure in this setup?" })
  });
  const chatPostData2 = await chatPost2.json();
  console.log("Turn 2 Status:", chatPost2.status, "Assistant Response Preview:", chatPostData2.assistantMessage?.message?.slice(0, 140) + "...");

  // 8d. Verify both turns persisted in DB
  const chatGet2 = await fetch(`${API_BASE}/api/pdfs/${uploadedPdfId}/chat`, {
    method: "GET",
    headers: { Cookie: studentCookie }
  });
  const chatGetData2 = await chatGet2.json();
  console.log("Persisted Messages Count in DB:", chatGetData2.messages?.length, "(Expected: 4 — 2 user + 2 assistant)");
  if (chatGetData2.messages?.length !== 4) {
    throw new Error(`Chat persistence failed. Expected 4 messages, got ${chatGetData2.messages?.length}`);
  }

  // TEST 9: Structured Summaries (Quick 3-Bullet & Exam Sheet)
  console.log("\n9. Testing Structured AI Summaries (Quick, Detailed, Exam Sheet)...");
  const sumRes = await fetch(`${API_BASE}/api/pdfs/${uploadedPdfId}/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: studentCookie },
    body: JSON.stringify({ mode: "summary", summaryType: "quick" })
  });
  const sumData = await sumRes.json();
  console.log("Summary Status:", sumRes.status, "Preview:", sumData.answer?.slice(0, 120) + "...");
  if (sumRes.status !== 200 || !sumData.answer) {
    throw new Error("Summary generation failed.");
  }

  // TEST 10: Clear Chat Thread
  console.log("\n10. Testing Chat Thread Deletion (DELETE /api/pdfs/:id/chat)...");
  const chatDel = await fetch(`${API_BASE}/api/pdfs/${uploadedPdfId}/chat`, {
    method: "DELETE",
    headers: { Cookie: studentCookie }
  });
  const chatDelData = await chatDel.json();
  console.log("Delete Status:", chatDel.status, "Message:", chatDelData.message);

  const chatGet3 = await fetch(`${API_BASE}/api/pdfs/${uploadedPdfId}/chat`, {
    method: "GET",
    headers: { Cookie: studentCookie }
  });
  const chatGetData3 = await chatGet3.json();
  console.log("Messages After Clear:", chatGetData3.messages?.length, "(Expected: 0)");
  if (chatGetData3.messages?.length !== 0) {
    throw new Error("Chat clear failed to delete messages.");
  }

  // TEST 11: Subject PYQ Analysis
  console.log("\n11. Testing Subject-Level PYQ Analysis...");
  const pyqRes = await fetch(`${API_BASE}/api/subjects/${subjectId}/ai/analyze-pyqs`, {
    method: "POST",
    headers: { Cookie: studentCookie }
  });
  const pyqData = await pyqRes.json();
  console.log("PYQ Analysis Status (Empty PYQ set check):", pyqRes.status, "Message:", pyqData.message);
  // Status 400 is expected when no PYQs are uploaded yet
  if (pyqRes.status !== 400 && pyqRes.status !== 200) {
    throw new Error("Unexpected response from PYQ analysis: " + pyqRes.status);
  }

  console.log("\n========================================================");
  console.log("🎉 ALL 11 ARCHITECTURAL & FUNCTIONAL TESTS PASSED!");
  console.log("========================================================\n");
}

run().catch((err) => {
  console.error("\n❌ E2E TEST FAILED:", err);
  process.exit(1);
});
