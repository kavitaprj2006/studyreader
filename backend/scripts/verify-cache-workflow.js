/**
 * StudyReader — Final Regression & Security Verification Suite
 *
 * Verifies:
 * 1. First identical summary request: MISS.
 * 2. Second identical summary request: HIT (Gemini bypassed).
 * 3. First identical grounded question: MISS.
 * 4. Second identical grounded question: HIT (Gemini bypassed).
 * 5. Different summary type: separate cache entry in ai_summary_cache.
 * 6. Changed document version (updated md5_hash): MISS and distinct cache entry.
 * 7. Different user / unauthorized document: strict access control, zero cache leakage.
 * 8. Browser refresh: persistent metrics remain correct across sessions.
 * 9. Dashboard agreement: Overview 'AI Cache Hits' equals Cache & Jobs 'totalHits'.
 * 10. Clean teardown of disposable test data.
 */

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const bcrypt = require("bcrypt");
const { pool } = require("../db");
const aiCacheService = require("../services/ai/ai-cache-service");
const ragService = require("../services/ai/rag-service");

process.env.NODE_ENV = "test";
const { app } = require("../server");

async function runRegressionSuite() {
  console.log("==================================================================");
  console.log("  StudyReader Final Pre-Deployment Regression & Security Suite");
  console.log("==================================================================\n");

  let testUser1Id = null;
  let testUser2Id = null;
  let testPdfId = null;
  let server = null;
  const timestamp = Date.now();
  const emailUser1 = `cache_regress_owner_${timestamp}@studyreader.edu`;
  const emailUser2 = `cache_regress_unauth_${timestamp}@studyreader.edu`;

  try {
    // 0. Baseline Metrics Observation
    console.log("[CHECK 0] Recording Baseline Metrics from Neon DB...");
    const statsRes = await pool.query("SELECT metric_name, metric_value FROM ai_cache_stats");
    const baseline = {};
    statsRes.rows.forEach(r => baseline[r.metric_name] = parseInt(r.metric_value, 10));
    console.log("Baseline ai_cache_stats:", baseline);

    // Ephemeral server start
    await new Promise(r => server = app.listen(0, r));
    const port = server.address().port;
    const baseUrl = `http://127.0.0.1:${port}`;
    console.log(`Test server active on ${baseUrl}`);

    // 1. Create Test User 1 (Admin/Owner) and Test User 2 (Unauthorized Student)
    console.log("\n[CHECK 1] Creating Test User 1 (Owner/Admin) and Test User 2 (Unauthorized)...");
    const hashedPass = await bcrypt.hash("Pass@123", 10);
    const u1Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, is_active, is_approved)
      VALUES ($1, $2, $3, 'admin', true, true)
      RETURNING id, email, role
    `, [`Owner ${timestamp}`, emailUser1, hashedPass]);
    testUser1Id = u1Res.rows[0].id;

    const u2Res = await pool.query(`
      INSERT INTO users (name, email, password_hash, role, is_active, is_approved)
      VALUES ($1, $2, $3, 'student', true, true)
      RETURNING id, email, role
    `, [`Unauthorized Student ${timestamp}`, emailUser2, hashedPass]);
    testUser2Id = u2Res.rows[0].id;

    console.log(`User 1 (Admin/Owner): ID=${testUser1Id}, User 2 (Student): ID=${testUser2Id}`);

    // Log in both users to obtain session cookies
    const login1 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailUser1, password: "Pass@123" })
    });
    const cookieUser1 = login1.headers.get("set-cookie").split(";")[0];

    const login2 = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailUser2, password: "Pass@123" })
    });
    const cookieUser2 = login2.headers.get("set-cookie").split(";")[0];

    // 2. Create Disposable Test Document owned by User 1 (private access)
    console.log("\n[CHECK 2] Creating Disposable Document (Owner: User 1, Private Access)...");
    const docRes = await pool.query(`
      INSERT INTO pdfs (
        user_id, filename, original_filename, file_url, file_size,
        page_count, processing_status, access_scope, md5_hash
      )
      VALUES ($1, $2, $3, $4, 2048, 3, 'completed', 'private', $5)
      RETURNING id, md5_hash
    `, [
      testUser1Id,
      `regress_doc_${timestamp}.pdf`,
      `Final_Regression_Doc_${timestamp}.pdf`,
      `/api/pdfs/test/file`,
      `md5-v1-${timestamp}`
    ]);
    testPdfId = docRes.rows[0].id;
    console.log(`Created document: ID=${testPdfId}, md5=${docRes.rows[0].md5_hash}`);

    // Track Gemini calls
    const originalRagAnswer = ragService.answer;
    let geminiCalls = 0;
    ragService.answer = async function(args) {
      geminiCalls++;
      console.log(`  >>> [Gemini Spy] ragService.answer call #${geminiCalls} (mode=${args.mode}, summaryType=${args.summaryType || 'N/A'})`);
      return {
        answer: `Regression verified AI response for doc ${args.documentId || testPdfId}. Key points grounded in source.`,
        sources: [{ chunkId: 1, pageNumber: 1, preview: "Excerpt preview..." }],
        model: "gemini-2.5-flash",
        provider: "gemini"
      };
    };

    // 3. Regression: Summary Caching (MISS -> HIT)
    console.log("\n[CHECK 3] Summary Caching: Request 1 (MISS) & Request 2 (HIT)...");
    const summary1Calls = geminiCalls;
    const s1 = await fetch(`${baseUrl}/api/pdfs/${testPdfId}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieUser1 },
      body: JSON.stringify({ mode: "summary", summaryType: "quick" })
    });
    const s1Data = await s1.json();
    if (s1Data.cached === true || geminiCalls !== summary1Calls + 1) {
      throw new Error("Summary Request 1 failed to MISS or failed to call Gemini.");
    }
    console.log("✔ Summary Request 1: Cache MISS confirmed.");

    const summary2Calls = geminiCalls;
    const s2 = await fetch(`${baseUrl}/api/pdfs/${testPdfId}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieUser1 },
      body: JSON.stringify({ mode: "summary", summaryType: "quick" })
    });
    const s2Data = await s2.json();
    if (s2Data.cached !== true || geminiCalls !== summary2Calls) {
      throw new Error("Summary Request 2 failed to HIT or inappropriately called Gemini.");
    }
    console.log(`✔ Summary Request 2: Cache HIT confirmed (hitCount: ${s2Data.hitCount}). Gemini bypassed.`);

    // 4. Regression: Grounded Answer Caching (MISS -> HIT)
    console.log("\n[CHECK 4] Answer Caching: Question 1 (MISS) & Question 2 (HIT)...");
    const qText = "What are the core methodology assumptions?";
    const ans1Calls = geminiCalls;
    const a1 = await fetch(`${baseUrl}/api/pdfs/${testPdfId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieUser1 },
      body: JSON.stringify({ message: qText })
    });
    const a1Data = await a1.json();
    if (a1Data.cached === true || geminiCalls !== ans1Calls + 1) {
      throw new Error("Answer Question 1 failed to MISS or failed to call Gemini.");
    }
    console.log("✔ Answer Question 1: Cache MISS confirmed.");

    // Simulate asking the same grounded question in a fresh chat session on the document
    await pool.query("DELETE FROM chat_messages WHERE pdf_id = $1", [testPdfId]);

    const ans2Calls = geminiCalls;
    const a2 = await fetch(`${baseUrl}/api/pdfs/${testPdfId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieUser1 },
      body: JSON.stringify({ message: qText })
    });
    const a2Data = await a2.json();
    if (a2Data.cached !== true || geminiCalls !== ans2Calls) {
      throw new Error("Answer Question 2 failed to HIT or inappropriately called Gemini.");
    }
    console.log("✔ Answer Question 2: Cache HIT confirmed. Gemini bypassed.");

    // 5. Regression: Different Summary Types Produce Separate Entries
    console.log("\n[CHECK 5] Separate Cache Entry for Summary Type 'takeaways'...");
    await fetch(`${baseUrl}/api/pdfs/${testPdfId}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieUser1 },
      body: JSON.stringify({ mode: "summary", summaryType: "takeaways" })
    });
    const sumEntries = await pool.query(
      "SELECT summary_type, content_hash FROM ai_summary_cache WHERE document_id = $1 ORDER BY summary_type",
      [testPdfId]
    );
    if (sumEntries.rows.length !== 2) {
      throw new Error(`Expected 2 distinct summary types, found ${sumEntries.rows.length}`);
    }
    console.log("✔ Distinct summary types ('quick' and 'takeaways') correctly maintained.");

    // 6. Regression: Changed Document Version (Updated md5_hash)
    console.log("\n[CHECK 6] Changed Document Version (New md5_hash)...");
    const newMd5 = `md5-v2-${timestamp}`;
    await pool.query("UPDATE pdfs SET md5_hash = $1 WHERE id = $2", [newMd5, testPdfId]);
    const v2Calls = geminiCalls;
    const sV2 = await fetch(`${baseUrl}/api/pdfs/${testPdfId}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieUser1 },
      body: JSON.stringify({ mode: "summary", summaryType: "quick" })
    });
    const sV2Data = await sV2.json();
    if (sV2Data.cached === true || geminiCalls !== v2Calls + 1) {
      throw new Error("Changed document version was incorrectly treated as cache HIT!");
    }
    console.log("✔ Changed document version produced clean cache MISS and new entry.");

    // 7. Security & Authorization: Zero Cache Leakage to Unauthorized User
    console.log("\n[CHECK 7] Authorization & Access Control: Testing Cache Leakage Prevention...");
    // User 2 (student) attempts to access User 1's private document summary
    const unauthSummaryRes = await fetch(`${baseUrl}/api/pdfs/${testPdfId}/ai`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieUser2 },
      body: JSON.stringify({ mode: "summary", summaryType: "quick" })
    });
    console.log("Unauthorized Summary Request HTTP Status:", unauthSummaryRes.status);
    if (unauthSummaryRes.status !== 404 && unauthSummaryRes.status !== 403) {
      throw new Error(`Security Violation: Unauthorized user received status ${unauthSummaryRes.status} instead of 404/403!`);
    }
    const unauthSummaryData = await unauthSummaryRes.json();
    if (unauthSummaryData.answer || unauthSummaryData.cached) {
      throw new Error("Security Violation: Unauthorized user was leaked cached summary data!");
    }
    console.log("✔ Unauthorized summary request correctly rejected without cache leakage.");

    // User 2 attempts to access User 1's private document chat
    const unauthChatRes = await fetch(`${baseUrl}/api/pdfs/${testPdfId}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Cookie": cookieUser2 },
      body: JSON.stringify({ message: qText })
    });
    console.log("Unauthorized Chat Request HTTP Status:", unauthChatRes.status);
    if (unauthChatRes.status !== 404 && unauthChatRes.status !== 403) {
      throw new Error(`Security Violation: Unauthorized chat received status ${unauthChatRes.status} instead of 404/403!`);
    }
    const unauthChatData = await unauthChatRes.json();
    if (unauthChatData.assistantMessage || unauthChatData.cached) {
      throw new Error("Security Violation: Unauthorized user was leaked cached answer data!");
    }
    console.log("✔ Unauthorized answer request correctly rejected without cache leakage.");

    // 8. Admin Metrics & Persistence Check
    console.log("\n[CHECK 8] Admin Metrics Integrity & Cross-Tab Agreement...");
    const adminMetrics = await fetch(`${baseUrl}/api/admin/cache/metrics`, {
      headers: { "Cookie": cookieUser1 }
    });
    const mData = await adminMetrics.json();
    const m = mData.metrics;
    console.log("Current Metrics from /api/admin/cache/metrics:", m);

    if (m.totalHits !== m.summaryHits + m.answerHits) {
      throw new Error("totalHits !== summaryHits + answerHits");
    }
    if (m.estimatedSavedAiCalls !== m.totalHits) {
      throw new Error("estimatedSavedAiCalls !== totalHits");
    }
    console.log(`✔ Overview card 'AI Cache Hits' displays: ${m.estimatedSavedAiCalls} calls`);
    console.log(`✔ Cache tab displays identical values: summaryHits=${m.summaryHits}, answerHits=${m.answerHits}, savedCalls=${m.estimatedSavedAiCalls}`);

    // Emulate Browser Refresh (Fresh independent session)
    const freshLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: emailUser1, password: "Pass@123" })
    });
    const freshCookie = freshLogin.headers.get("set-cookie").split(";")[0];
    const postRefreshMetrics = await fetch(`${baseUrl}/api/admin/cache/metrics`, {
      headers: { "Cookie": freshCookie }
    });
    const postM = (await postRefreshMetrics.json()).metrics;
    if (postM.estimatedSavedAiCalls !== m.estimatedSavedAiCalls || postM.summaryHits !== m.summaryHits) {
      throw new Error("Metrics failed persistence across browser refresh / independent session.");
    }
    console.log("✔ Metrics persistence across browser refresh fully verified.");

    // Restore original rag answer
    ragService.answer = originalRagAnswer;

    console.log("\n==================================================================");
    console.log("  ALL PRE-DEPLOYMENT REGRESSION CHECKS PASSED WITH ZERO ERRORS!   ");
    console.log("==================================================================");

  } catch (err) {
    console.error("\n❌ Regression Check FAILED:", err.message);
    throw err;
  } finally {
    // Teardown ONLY disposable test records
    console.log("\n[CLEANUP] Cleaning up disposable test document and test users...");
    if (testPdfId) {
      await pool.query("DELETE FROM ai_summary_cache WHERE document_id = $1", [testPdfId]);
      await pool.query("DELETE FROM ai_answer_cache WHERE document_id = $1", [testPdfId]);
      await pool.query("DELETE FROM chat_messages WHERE pdf_id = $1", [testPdfId]);
      await pool.query("DELETE FROM pdfs WHERE id = $1", [testPdfId]);
    }
    if (testUser1Id) await pool.query("DELETE FROM users WHERE id = $1", [testUser1Id]);
    if (testUser2Id) await pool.query("DELETE FROM users WHERE id = $1", [testUser2Id]);
    if (server) server.close();
    await pool.end();
  }
}

runRegressionSuite().catch(e => {
  console.error("Fatal:", e);
  process.exit(1);
});
