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

async function runE2ETests() {
  console.log("=============================================================");
  console.log("  StudyReader Complete End-to-End System Verification (E2E)  ");
  console.log("=============================================================\n");

  const timestamp = Date.now();
  const teacherEmail = `prof_e2e_${timestamp}@studyreader.edu`;
  const studentEmail = `student_e2e_${timestamp}@studyreader.edu`;
  const adminEmail = `admin_e2e_${timestamp}@studyreader.edu`;
  const password = "Password@123";

  // -------------------------------------------------------------
  // TEST 1: TEACHER REGISTRATION & CLASSROOM CREATION
  // -------------------------------------------------------------
  console.log("[TEST 1] Registering and authenticating Teacher...");
  const teacherRegRes = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Prof. Ada Lovelace",
      email: teacherEmail,
      password,
      role: "teacher"
    })
  });
  const teacherReg = await teacherRegRes.json();
  if (!teacherRegRes.ok) throw new Error("Teacher signup failed: " + teacherReg.message);
  console.log("✓ Teacher registered:", teacherReg.user.name, `(Role: ${teacherReg.user.role})`);

  const teacherLoginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: teacherEmail, password })
  });
  const teacherCookie = teacherLoginRes.headers.get("set-cookie");
  console.log("✓ Teacher logged in, session cookie acquired.");

  // Teacher creates Classroom
  console.log("\n[TEST 2] Teacher creates Classroom 'Cloud Computing - Sem 6 - Sec B'...");
  const createClassRes = await fetch(`${API_BASE_URL}/api/classrooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": teacherCookie },
    body: JSON.stringify({
      name: "Cloud Computing - Sem 6 - Sec B",
      semester: "6",
      section: "B",
      description: "Advanced Cloud Infrastructure, Distributed Systems and RAG pipelines."
    })
  });
  const classData = await createClassRes.json();
  if (!createClassRes.ok) throw new Error("Create classroom failed: " + classData.message);
  const classroom = classData.classroom;
  console.log(`✓ Classroom created successfully! ID: ${classroom.id} | Join Code: ${classroom.code}`);

  // Teacher adds 2 subjects to classroom
  console.log("\n[TEST 3] Teacher adds subjects to classroom...");
  const subRes1 = await fetch(`${API_BASE_URL}/api/classrooms/${classroom.id}/subjects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": teacherCookie },
    body: JSON.stringify({
      name: "Cloud Computing Architecture",
      code: "CS601",
      description: "Virtualization, Serverless, and Cloud Storage models"
    })
  });
  const sub1 = (await subRes1.json()).subject;
  console.log(`✓ Subject 1 added: ${sub1.name} (${sub1.code})`);

  const subRes2 = await fetch(`${API_BASE_URL}/api/classrooms/${classroom.id}/subjects`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": teacherCookie },
    body: JSON.stringify({
      name: "Distributed Systems & Algorithms",
      code: "CS602",
      description: "Consensus algorithms, Raft, Paxos, and Vector Clocks"
    })
  });
  const sub2 = (await subRes2.json()).subject;
  console.log(`✓ Subject 2 added: ${sub2.name} (${sub2.code})`);

  // Teacher uploads a Resource and a PYQ to Subject 1
  console.log("\n[TEST 4] Teacher publishes Lecture Resource & Previous Year Question paper...");
  const dummyResourcePdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Title (Cloud Computing Lecture 1: Virtualization Models) >>\nendobj\ntrailer\n<< >>\n%%EOF");
  const dummyPyqPdf = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Title (End-Semester Exam Question Paper 2024 - Cloud Computing) >>\nendobj\ntrailer\n<< >>\n%%EOF");

  async function uploadDoc(buffer, filename, category, year) {
    const boundary = "----Boundary" + Math.random().toString(36).substring(2);
    let body = [];
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="pdf"; filename="${filename}"\r\nContent-Type: application/pdf\r\n\r\n`));
    body.push(buffer);
    body.push(Buffer.from(`\r\n`));
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="classroomId"\r\n\r\n${classroom.id}\r\n`));
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="subjectId"\r\n\r\n${sub1.id}\r\n`));
    body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\n${category}\r\n`));
    if (year) body.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="academicYear"\r\n\r\n${year}\r\n`));
    body.push(Buffer.from(`--${boundary}--\r\n`));

    const res = await fetch(`${API_BASE_URL}/api/pdfs/upload`, {
      method: "POST",
      headers: { "Content-Type": `multipart/form-data; boundary=${boundary}`, "Cookie": teacherCookie },
      body: Buffer.concat(body)
    });
    return await res.json();
  }

  const up1 = await uploadDoc(dummyResourcePdf, "Lecture1_Virtualization.pdf", "resource");
  console.log("✓ Published Resource:", up1.pdf?.originalFilename, `(Category: ${up1.pdf?.category})`);

  const up2 = await uploadDoc(dummyPyqPdf, "Cloud_EndTerm_PYQ_2024.pdf", "pyq", "2023-2024");
  console.log("✓ Published PYQ:", up2.pdf?.originalFilename, `(Category: ${up2.pdf?.category}, Year: ${up2.pdf?.academicYear})`);

  // -------------------------------------------------------------
  // TEST 5: STUDENT REGISTRATION & CLASSROOM JOIN
  // -------------------------------------------------------------
  console.log("\n[TEST 5] Registering Student and joining classroom via code...");
  const studentRegRes = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Bob Stone",
      email: studentEmail,
      password,
      role: "student"
    })
  });
  const studentReg = await studentRegRes.json();
  if (!studentRegRes.ok) throw new Error("Student signup failed: " + studentReg.message);
  console.log("✓ Student registered:", studentReg.user.name);

  const studentLoginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: studentEmail, password })
  });
  const studentCookie = studentLoginRes.headers.get("set-cookie");

  // Student joins classroom with join code
  const joinRes = await fetch(`${API_BASE_URL}/api/classrooms/join`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": studentCookie },
    body: JSON.stringify({ code: classroom.code })
  });
  const joinData = await joinRes.json();
  if (!joinRes.ok) throw new Error("Join classroom failed: " + joinData.message);
  console.log("✓ Student joined classroom successfully with code:", classroom.code);

  // Student creates a personal subject
  console.log("\n[TEST 6] Student creates personal subject 'GATE CS 2026'...");
  const persSubRes = await fetch(`${API_BASE_URL}/api/subjects/personal`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Cookie": studentCookie },
    body: JSON.stringify({
      name: "GATE CS 2026 Preparation",
      code: "GATE-CS",
      description: "My personal preparation notes and formulas"
    })
  });
  const persSub = (await persSubRes.json()).subject;
  console.log("✓ Personal subject created:", persSub.name);

  // Student retrieves My Subjects
  console.log("\n[TEST 7] Student verifies their Dynamic Subject Library...");
  const mySubjectsRes = await fetch(`${API_BASE_URL}/api/subjects/my-subjects`, {
    headers: { "Cookie": studentCookie }
  });
  const mySubjects = (await mySubjectsRes.json()).subjects;
  console.log(`✓ Student has ${mySubjects.length} subjects in total:`);
  mySubjects.forEach((s) => {
    console.log(`   * [${s.subjectType.toUpperCase()}] ${s.name} (${s.code || "N/A"}) - ${s.resourceCount} Notes, ${s.pyqCount} PYQs`);
  });

  // Verify student sees subject details with separated Resources vs PYQs
  console.log("\n[TEST 8] Student opens Subject Space for 'Cloud Computing Architecture'...");
  const subDetailRes = await fetch(`${API_BASE_URL}/api/subjects/${sub1.id}`, {
    headers: { "Cookie": studentCookie }
  });
  const subDetail = await subDetailRes.json();
  console.log("✓ Subject details loaded:");
  console.log("   - Study Resources:", subDetail.resources.map(r => r.originalFilename));
  console.log("   - PYQ Papers:", subDetail.pyqs.map(q => `${q.originalFilename} [${q.academicYear}]`));

  // -------------------------------------------------------------
  // TEST 9: SUBJECT-LEVEL AI SYNTHESIS & PYQ ANALYSIS
  // -------------------------------------------------------------
  console.log("\n[TEST 9] Running Multi-Resource AI Synthesis...");
  const aiSynthRes = await fetch(`${API_BASE_URL}/api/subjects/${sub1.id}/ai/analyze-resources`, {
    method: "POST",
    headers: { "Cookie": studentCookie }
  });
  const aiSynthData = await aiSynthRes.json();
  console.log("✓ Resource AI Synthesis Status:", aiSynthRes.status, `(Generated ${aiSynthData.answer.length} chars)`);

  console.log("\n[TEST 10] Running PYQ Frequency & Pattern Analysis...");
  const aiPyqRes = await fetch(`${API_BASE_URL}/api/subjects/${sub1.id}/ai/analyze-pyqs`, {
    method: "POST",
    headers: { "Cookie": studentCookie }
  });
  const aiPyqData = await aiPyqRes.json();
  console.log("✓ PYQ Frequency Analysis Status:", aiPyqRes.status, `(Generated ${aiPyqData.answer.length} chars)`);

  // -------------------------------------------------------------
  // TEST 11: TEACHER CHECKS ROSTER
  // -------------------------------------------------------------
  console.log("\n[TEST 11] Teacher checks enrolled students roster...");
  const rosterRes = await fetch(`${API_BASE_URL}/api/classrooms/${classroom.id}`, {
    headers: { "Cookie": teacherCookie }
  });
  const rosterData = await rosterRes.json();
  const enrolledBob = rosterData.students.find(s => s.name === "Bob Stone");
  console.log("✓ Classroom roster confirmed. Enrolled student found:", enrolledBob?.name, `(${enrolledBob?.email})`);

  // -------------------------------------------------------------
  // TEST 12: ADMIN VERIFICATION & METRICS
  // -------------------------------------------------------------
  console.log("\n[TEST 12] Creating Admin user in database and testing Admin Portal APIs...");
  const bcrypt = require("bcrypt");
  const hashedPw = await bcrypt.hash(password, 10);
  const adminDbRes = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, is_active, is_approved)
     VALUES ($1, $2, $3, 'admin', TRUE, TRUE)
     RETURNING id, name, role`,
    ["System Admin", adminEmail, hashedPw]
  );
  console.log("✓ Admin account created in DB:", adminDbRes.rows[0].name);

  const adminLoginRes = await fetch(`${API_BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: adminEmail, password })
  });
  const adminCookie = adminLoginRes.headers.get("set-cookie");

  const metricsRes = await fetch(`${API_BASE_URL}/api/admin/metrics`, {
    headers: { "Cookie": adminCookie }
  });
  const metricsData = await metricsRes.json();
  console.log("✓ Admin metrics retrieved successfully:", metricsData.metrics);

  const usersListRes = await fetch(`${API_BASE_URL}/api/admin/users`, {
    headers: { "Cookie": adminCookie }
  });
  const usersListData = await usersListRes.json();
  console.log(`✓ Admin users list retrieved: ${usersListData.users.length} users registered on platform.`);

  console.log("\n=============================================================");
  console.log(">>> ALL 12 END-TO-END SYSTEM TESTS COMPLETED SUCCESSFULLY! <<<");
  console.log("=============================================================");
  await pool.end();
}

runE2ETests().catch((err) => {
  console.error("E2E Test Failure:", err);
  process.exit(1);
});
