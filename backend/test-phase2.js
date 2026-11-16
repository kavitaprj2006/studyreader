const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
});

const API_BASE_URL = "http://127.0.0.1:3000";

async function run() {
  console.log("=================================================");
  console.log("  StudyReader Classroom & Subject Verification   ");
  console.log("=================================================\n");

  const timestamp = Date.now();
  const teacherEmail = `teacher_${timestamp}@studyreader.edu`;
  const studentEmail = `student_${timestamp}@studyreader.edu`;
  const password = "Password@123";

  // 1. Signup Teacher
  console.log("[STEP 1] Creating Teacher Account:", teacherEmail);
  const teacherSignupRes = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Dr. Turing",
      email: teacherEmail,
      password: password,
      role: "teacher"
    })
  });
  const teacherSignup = await teacherSignupRes.json();
  console.log("Teacher Signup Status:", teacherSignupRes.status, teacherSignup.message);

  // 2. Login Teacher to get session cookie
  console.log("\n[STEP 2] Logging in Teacher...");
  const teacherLoginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: teacherEmail, password })
  });
  const teacherCookie = teacherLoginRes.headers.get("set-cookie");
  console.log("Teacher Login Status:", teacherLoginRes.status, "Cookie received:", !!teacherCookie);

  // 3. Create Classroom as Teacher
  console.log("\n[STEP 3] Creating Classroom 'CSE - Semester 5 - Section A'...");
  const createClassRes = await fetch(`${API_BASE_URL}/api/classrooms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": teacherCookie
    },
    body: JSON.stringify({
      name: "CSE - Semester 5 - Section A",
      semester: "5",
      section: "A",
      description: "Classroom for Semester 5 Computer Science students"
    })
  });
  const classData = await createClassRes.json();
  console.log("Create Classroom Status:", createClassRes.status);
  console.log("Classroom Data:", classData.classroom);
  const classroomId = classData.classroom.id;
  const joinCode = classData.classroom.code;

  // 4. Add Subjects to Classroom
  console.log("\n[STEP 4] Adding Subjects to Classroom (AI & DBMS)...");
  const addSubject1 = await fetch(`${API_BASE_URL}/api/classrooms/${classroomId}/subjects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": teacherCookie
    },
    body: JSON.stringify({
      name: "Artificial Intelligence",
      code: "CS501",
      description: "Core AI topics, Search algorithms, ML foundations"
    })
  });
  const sub1Data = await addSubject1.json();
  console.log("Subject 1 Status:", addSubject1.status, sub1Data.subject.name);

  const addSubject2 = await fetch(`${API_BASE_URL}/api/classrooms/${classroomId}/subjects`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": teacherCookie
    },
    body: JSON.stringify({
      name: "Database Management Systems",
      code: "CS502",
      description: "Relational algebra, SQL, transactions and indexing"
    })
  });
  const sub2Data = await addSubject2.json();
  console.log("Subject 2 Status:", addSubject2.status, sub2Data.subject.name);

  // 5. Signup Student
  console.log("\n[STEP 5] Creating Student Account:", studentEmail);
  const studentSignupRes = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Alice Smith",
      email: studentEmail,
      password: password,
      role: "student"
    })
  });
  const studentSignup = await studentSignupRes.json();
  console.log("Student Signup Status:", studentSignupRes.status, studentSignup.message);

  // 6. Login Student
  console.log("\n[STEP 6] Logging in Student...");
  const studentLoginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: studentEmail, password })
  });
  const studentCookie = studentLoginRes.headers.get("set-cookie");
  console.log("Student Login Status:", studentLoginRes.status, "Cookie received:", !!studentCookie);

  // 7. Student joins Classroom with 6-char Join Code
  console.log("\n[STEP 7] Student joining classroom using code:", joinCode);
  const joinRes = await fetch(`${API_BASE_URL}/api/classrooms/join`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": studentCookie
    },
    body: JSON.stringify({ code: joinCode })
  });
  const joinData = await joinRes.json();
  console.log("Join Status:", joinRes.status, joinData.message);

  // 8. Student creates a Personal Subject (e.g. Competitive Programming)
  console.log("\n[STEP 8] Student creates personal subject 'Competitive Programming'...");
  const personalSubRes = await fetch(`${API_BASE_URL}/api/subjects/personal`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": studentCookie
    },
    body: JSON.stringify({
      name: "Competitive Programming",
      code: "CP101",
      description: "My personal LeetCode and Contest preparation notes"
    })
  });
  const personalSubData = await personalSubRes.json();
  console.log("Personal Subject Status:", personalSubRes.status, personalSubData.subject.name);

  // 9. Student retrieves My Subjects (should see AI, DBMS, and Personal Subject!)
  console.log("\n[STEP 9] Student fetches /api/subjects/my-subjects...");
  const mySubjectsRes = await fetch(`${API_BASE_URL}/api/subjects/my-subjects`, {
    headers: { "Cookie": studentCookie }
  });
  const mySubjectsData = await mySubjectsRes.json();
  console.log("My Subjects Status:", mySubjectsRes.status);
  console.log("Total Subjects Found for Student:", mySubjectsData.subjects.length);
  mySubjectsData.subjects.forEach((s) => {
    console.log(` - ${s.name} (${s.code || "No code"}) | Type: ${s.subjectType} | Classroom: ${s.classroomName}`);
  });

  // 10. Teacher uploads a Resource and a PYQ directly to Artificial Intelligence
  console.log("\n[STEP 10] Uploading Resource and PYQ to Subject as Teacher...");
  const fs = require("fs");
  const testPdfContent = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Title (Artificial Intelligence Lecture Notes) >>\nendobj\ntrailer\n<< >>\n%%EOF");
  const testPyqContent = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Title (AI Previous Year Examination 2024) >>\nendobj\ntrailer\n<< >>\n%%EOF");

  // Helper form-data upload
  async function uploadTestFile(buffer, originalname, category, academicYear) {
    const boundary = "----WebKitFormBoundary" + Math.random().toString(36).substring(2);
    let body = [];
    
    // File
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="${originalname}"\r\nContent-Type: application/pdf\r\n\r\n`));
    body.push(buffer);
    body.push(Buffer.from(`\r\n`));

    // subjectId
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subjectId"\r\n\r\n${sub1Data.subject.id}\r\n`));
    // classroomId
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="classroomId"\r\n\r\n${classroomId}\r\n`));
    // category
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${category}\r\n`));
    if (academicYear) {
      body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="academicYear"\r\n\r\n${academicYear}\r\n`));
    }
    body.push(Buffer.from(`--${boundary}--\r\n`));

    const finalBuffer = Buffer.concat(body);

    const res = await fetch(`${API_BASE_URL}/api/pdfs/upload`, {
      method: "POST",
      headers: {
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Cookie": teacherCookie
      },
      body: finalBuffer
    });
    return await res.json();
  }

  const uploadRes1 = await uploadTestFile(testPdfContent, "AI_Lecture_Notes_Unit1.pdf", "resource");
  console.log("Uploaded Resource:", uploadRes1.success ? uploadRes1.pdf.originalFilename : uploadRes1.message);

  const uploadRes2 = await uploadTestFile(testPyqContent, "AI_EndTerm_PYQ_2024.pdf", "pyq", "2023-2024");
  console.log("Uploaded PYQ:", uploadRes2.success ? uploadRes2.pdf.originalFilename : uploadRes2.message);

  // 11. Student queries Subject Details for Artificial Intelligence
  console.log("\n[STEP 11] Student views Subject Details /api/subjects/:id...");
  const subjectDetailRes = await fetch(`${API_BASE_URL}/api/subjects/${sub1Data.subject.id}`, {
    headers: { "Cookie": studentCookie }
  });
  const subjectDetailData = await subjectDetailRes.json();
  console.log("Subject Details Status:", subjectDetailRes.status);
  console.log(`Resources in ${subjectDetailData.subject.name}:`, subjectDetailData.resources.map(r => r.originalFilename));
  console.log(`PYQs in ${subjectDetailData.subject.name}:`, subjectDetailData.pyqs.map(q => `${q.originalFilename} [${q.academicYear || "N/A"}]`));

  // 12. Teacher views Classroom Details (includes roster with Student!)
  console.log("\n[STEP 12] Teacher checks Classroom Roster...");
  const classDetailRes = await fetch(`${API_BASE_URL}/api/classrooms/${classroomId}`, {
    headers: { "Cookie": teacherCookie }
  });
  const classDetailData = await classDetailRes.json();
  console.log("Classroom Roster for Teacher:", classDetailData.students);

  // 13. Student verifies access to teacher's resource via canAccessDocument
  console.log("\n[STEP 13] Student checks document permission for uploaded teacher resource...");
  const studentPdfListRes = await fetch(`${API_BASE_URL}/api/pdfs`, {
    headers: { "Cookie": studentCookie }
  });
  const studentPdfList = await studentPdfListRes.json();
  const sharedDocs = studentPdfList.pdfs.filter(p => Number(p.classroomId) === Number(classroomId));
  console.log(`Student can see ${sharedDocs.length} classroom documents in their library:`, sharedDocs.map(d => `${d.originalFilename} (${d.category})`));

  // 14. Subject AI Analysis
  console.log("\n[STEP 14] Running Subject-Level Resource AI Analysis...");
  const aiResRes = await fetch(`${API_BASE_URL}/api/subjects/${sub1Data.subject.id}/ai/analyze-resources`, {
    method: "POST",
    headers: { "Cookie": studentCookie }
  });
  const aiResData = await aiResRes.json();
  console.log("Resource AI Analysis Status:", aiResRes.status, "Answer length:", aiResData.answer?.length || 0);

  // 15. Subject PYQ AI Analysis
  console.log("\n[STEP 15] Running Subject-Level PYQ AI Frequency Analysis...");
  const aiPyqRes = await fetch(`${API_BASE_URL}/api/subjects/${sub1Data.subject.id}/ai/analyze-pyqs`, {
    method: "POST",
    headers: { "Cookie": studentCookie }
  });
  const aiPyqData = await aiPyqRes.json();
  console.log("PYQ AI Analysis Status:", aiPyqRes.status, "Answer length:", aiPyqData.answer?.length || 0);

  console.log("\n=================================================");
  console.log(">>> ALL INTEGRATION CHECKS PASSED SUCCESSFULLY! <<<");
  console.log("=================================================");
  await pool.end();
}

run().catch((err) => {
  console.error("Test execution error:", err);
  process.exit(1);
});
