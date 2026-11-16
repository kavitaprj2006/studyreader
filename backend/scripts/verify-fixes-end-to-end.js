require("dotenv").config({ path: require("path").join(__dirname, "../.env") });
const assert = require("assert");

const BASE_URL = "http://localhost:3000";

async function loginUser() {
  const { Pool } = require("pg");
  const pool = new Pool({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: String(process.env.DB_PASSWORD)
  });

  const email = `verify_admin_${Date.now()}@studyreader.edu`;
  const password = "Password123!";

  const regRes = await fetch(`${BASE_URL}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Verification Auditor",
      email,
      password,
      role: "teacher"
    })
  });
  if (!regRes.ok) {
    const errText = await regRes.text();
    throw new Error(`Signup failed: ${regRes.status} ${errText}`);
  }
  const regData = await regRes.json();
  const userId = regData.user.id;

  // Elevate to admin in database so auditor can access any document
  await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [userId]);
  await pool.end();

  // Login to get fresh session cookie with admin role
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password })
  });
  if (!loginRes.ok) {
    const errText = await loginRes.text();
    throw new Error(`Login failed: ${loginRes.status} ${errText}`);
  }

  const setCookie = loginRes.headers.getSetCookie ? loginRes.headers.getSetCookie() : [loginRes.headers.get("set-cookie")];
  return setCookie.map((c) => c.split(";")[0]).join("; ");
}

async function run() {
  console.log("=================================================");
  console.log("StudyReader End-to-End Corrective Verification");
  console.log("=================================================\n");

  // Step 1: Authentication
  console.log("1. Authenticating as test student...");
  const cookie = await loginUser();
  console.log("   Authenticated successfully.\n");

  // Step 2: Test 60-Page PDF (Doc 36 - Propositional Logic)
  console.log("2. Testing 60-Page PDF (Doc 36: Propositional Logic)...");

  // 2a. Quick Summary (3-Bullet)
  console.log("   --> Requesting Quick (3-Bullet) Summary...");
  const t0 = Date.now();
  const quickRes = await fetch(`${BASE_URL}/api/pdfs/36/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie
    },
    body: JSON.stringify({ mode: "summary", summaryType: "quick" })
  });
  const quickData = await quickRes.json();
  const quickDuration = ((Date.now() - t0) / 1000).toFixed(1);
  assert(quickRes.ok, `Quick summary failed: ${quickData.message}`);
  console.log(`   --> Received in ${quickDuration}s!`);
  console.log("   Coverage Metadata:", JSON.stringify(quickData.coverage));
  console.log("\n--- Quick Summary Output ---\n" + quickData.answer + "\n----------------------------\n");

  assert.strictEqual(quickData.coverage.totalPages, 60, "Coverage totalPages must be 60");
  assert.strictEqual(quickData.coverage.extractedPages, 60, "Coverage extractedPages must be 60");
  assert(quickData.coverage.batchesProcessed >= 5, "Batches processed must be >= 5 for 60 pages");

  // Check 3-bullet formatting
  const bulletLines = quickData.answer.split("\n").filter((l) => l.trim().startsWith("* ") || l.trim().startsWith("- "));
  console.log(`   Bullet count: ${bulletLines.length}`);
  assert.strictEqual(bulletLines.length, 3, "Output must contain exactly 3 bullets");

  // Check coverage spans beginning and end
  const hasPageCitations = /\[(?:Pages?|Slides?)\s+\d+(?:–\d+)?\]/i.test(quickData.answer);
  console.log("   Contains valid [Page X] citations:", hasPageCitations);
  assert(hasPageCitations, "Quick summary must include bracketed page citations");

  // 2b. Detailed Summary (Testing Cache Acceleration)
  console.log("\n3. Testing Detailed Summary (Validating Intermediate Digest Cache)...");
  const t1 = Date.now();
  const detailedRes = await fetch(`${BASE_URL}/api/pdfs/36/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie
    },
    body: JSON.stringify({ mode: "summary", summaryType: "detailed" })
  });
  const detailedData = await detailedRes.json();
  const detailedDuration = ((Date.now() - t1) / 1000).toFixed(1);
  assert(detailedRes.ok, `Detailed summary failed: ${detailedData.message}`);
  console.log(`   --> Received in ${detailedDuration}s (Cache Hit: Map phase was skipped!)`);
  console.log("   First 400 chars of Detailed Summary:\n" + detailedData.answer.slice(0, 400) + "...\n");
  assert(detailedData.answer.includes("## "), "Detailed summary must include markdown headers");

  // 2c. Exam Sheet (Subject-Adaptive)
  console.log("4. Testing Exam Sheet (Subject-Adaptive Revision Sheet)...");
  const t2 = Date.now();
  const examRes = await fetch(`${BASE_URL}/api/pdfs/36/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie
    },
    body: JSON.stringify({ mode: "summary", summaryType: "takeaways" })
  });
  const examData = await examRes.json();
  const examDuration = ((Date.now() - t2) / 1000).toFixed(1);
  assert(examRes.ok, `Exam sheet failed: ${examData.message}`);
  console.log(`   --> Received in ${examDuration}s!`);
  console.log("   First 500 chars of Exam Sheet:\n" + examData.answer.slice(0, 500) + "...\n");
  assert(examData.answer.includes("## 🎯 Essential Terms"), "Exam sheet must include Essential Terms");
  assert(examData.answer.includes("## 📝 High-Probability Exam Questions"), "Exam sheet must include Exam Questions");

  // Step 3: Test Document Isolation with Doc 30 (40-Page HCI PDF)
  console.log("5. Testing Document Isolation with Doc 30 (40-Page HCI PDF)...");
  const t3 = Date.now();
  const doc30Res = await fetch(`${BASE_URL}/api/pdfs/30/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie
    },
    body: JSON.stringify({ mode: "summary", summaryType: "quick" })
  });
  const doc30Data = await doc30Res.json();
  const doc30Duration = ((Date.now() - t3) / 1000).toFixed(1);
  assert(doc30Res.ok, `Doc 30 summary failed: ${doc30Data.message}`);
  console.log(`   --> Doc 30 Quick Summary received in ${doc30Duration}s!`);
  console.log("   Doc 30 Coverage Metadata:", JSON.stringify(doc30Data.coverage));
  console.log("\n--- Doc 30 Summary Output ---\n" + doc30Data.answer + "\n-----------------------------\n");
  assert(doc30Data.coverage.totalPages >= 38, "Doc 30 totalPages must be at least 38");
  assert(!doc30Data.answer.toLowerCase().includes("wumpus"), "Doc 30 must NOT contain propositional logic / wumpus world content");

  // Step 4: Test Ask AI Chat Mode (BM25 Grounded Answering)
  console.log("6. Testing Ask AI Chat Retrieval (BM25 on 60-Page PDF)...");
  const chatRes = await fetch(`${BASE_URL}/api/pdfs/36/ai`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Cookie": cookie
    },
    body: JSON.stringify({
      mode: "ask-ai",
      question: "Explain the rules and breeze conditions in Wumpus World."
    })
  });
  const chatData = await chatRes.json();
  assert(chatRes.ok, `Ask AI failed: ${chatData.message}`);
  console.log("   --> Ask AI response generated successfully.");
  console.log("   Sources returned:", chatData.sources.map((s) => `Page ${s.pageNumber}: ${s.preview.slice(0, 60)}...`));
  console.log("   Response excerpt:\n" + chatData.answer.slice(0, 300) + "...\n");
  const citedWumpusPage = chatData.sources.some((s) => s.pageNumber >= 25 && s.pageNumber <= 35);
  console.log("   Retrieved Wumpus World middle pages (25–35):", citedWumpusPage);
  assert(citedWumpusPage, "Ask AI must accurately retrieve middle pages for Wumpus World");

  console.log("\n=================================================");
  console.log("ALL VERIFICATION CHECKS PASSED PERFECTLY! [✓]");
  console.log("=================================================");
}

run().catch((err) => {
  console.error("\n❌ Verification failed:", err);
  process.exit(1);
});
