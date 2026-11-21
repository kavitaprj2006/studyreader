/**
 * Test Suite for StudyReader Smart Academic Subject Classifier (Node.js)
 */

const assert = require('assert');
const cookieSignature = require('cookie-signature');
const { subjectClassifier } = require('../services/ml/subject-classifier');
const { app, pool, jobProcessor } = require('../server');

async function runTests() {
  console.log('\n======================================================');
  console.log('STUDYREADER SMART ACADEMIC CLASSIFIER TEST SUITE');
  console.log('======================================================\n');

  // Test 1: Model Bundle Loaded
  console.log('Test 1: Verify model bundle integrity...');
  assert.strictEqual(subjectClassifier.isLoaded, true, 'Model bundle should be loaded');
  assert.strictEqual(subjectClassifier.classes.length, 15, 'Should support 15 canonical academic classes');
  assert.ok(subjectClassifier.version, 'Model version should be present');
  console.log(`  ✔ Model bundle v${subjectClassifier.version} loaded with ${subjectClassifier.classes.length} classes.\n`);

  // Test 2: Operating Systems Document Classification
  console.log('Test 2: Classify Operating Systems document excerpt...');
  const osText = `
    Operating Systems Lecture 4: Process Management and CPU Scheduling.
    In this module, we examine how the kernel handles process scheduling using Round Robin and
    Shortest Job First. Virtual memory paging, page tables, TLB hits, and deadlocks with Coffman conditions.
  `;
  const osResult = subjectClassifier.predict(osText);
  assert.strictEqual(osResult.predictedSubject, 'Operating Systems');
  assert.ok(osResult.confidence > 0.35, `Confidence ${osResult.confidence} should exceed threshold`);
  console.log(`  ✔ Predicted: '${osResult.predictedSubject}' (Confidence: ${(osResult.confidence * 100).toFixed(2)}%)\n`);

  // Test 3: Computer Networks Document Classification
  console.log('Test 3: Classify Computer Networks document excerpt...');
  const netText = `
    Computer Networks Chapter 5: Transport Layer and Congestion Control.
    The TCP three-way handshake (SYN, SYN-ACK, ACK) establishes reliable end-to-end byte streams.
    Contrast with UDP datagrams. IP addressing, subnetting with CIDR masks, DNS name resolution, and routing.
  `;
  const netResult = subjectClassifier.predict(netText);
  assert.strictEqual(netResult.predictedSubject, 'Computer Networks');
  assert.ok(netResult.confidence > 0.35);
  console.log(`  ✔ Predicted: '${netResult.predictedSubject}' (Confidence: ${(netResult.confidence * 100).toFixed(2)}%)\n`);

  // Test 4: Dynamic User Catalog Matching with Aliases
  console.log('Test 4: Verify dynamic catalog matching with alias resolution...');
  const userCatalog = [
    { id: 10, name: 'Data Comm & Networking', code: 'CN-301' },
    { id: 20, name: 'OS Lab', code: 'CS-204' },
    { id: 30, name: 'Discrete Structures', code: 'MATH-102' }
  ];

  const matched = subjectClassifier.matchUserSubject('Computer Networks', userCatalog);
  assert.ok(matched, 'Should match Computer Networks via alias to CN-301');
  assert.strictEqual(matched.id, 10);
  console.log(`  ✔ Successfully resolved 'Computer Networks' to user catalog entry #${matched.id} (${matched.name})\n`);

  // Test 5: End-to-End classifyDocument() method
  console.log('Test 5: Full classifyDocument() with catalog matching...');
  const fullResult = subjectClassifier.classifyDocument(osText, userCatalog);
  assert.strictEqual(fullResult.predictedSubject, 'Operating Systems');
  assert.strictEqual(fullResult.matchedSubjectId, 20);
  assert.strictEqual(fullResult.status, 'classified');
  assert.strictEqual(fullResult.source, 'ml_auto');
  console.log(`  ✔ End-to-end result: status='${fullResult.status}', matchedSubjectId=${fullResult.matchedSubjectId}\n`);

  // Test 6: Safe Fallback on Nonsense / Empty Input
  console.log('Test 6: Safe error fallback on empty or meaningless text...');
  const emptyRes = subjectClassifier.classifyDocument('', userCatalog);
  assert.strictEqual(emptyRes.status, 'unclassified');
  assert.strictEqual(emptyRes.confidence, 0);

  const gibberishRes = subjectClassifier.classifyDocument('zzzz yyyy xxxx 999 888', userCatalog);
  assert.strictEqual(gibberishRes.status, 'unclassified');
  console.log('  ✔ Handled invalid inputs gracefully without throwing exceptions.\n');

  // Test 7: Verify Database Schema & Table Columns
  console.log('Test 7: Verify database schema integrity in Neon PostgreSQL...');
  const subCols = await pool.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'subjects' AND column_name IN ('educational_level', 'course_or_grade', 'semester', 'is_active')
  `);
  assert.strictEqual(subCols.rows.length, 4, 'subjects table should contain all 4 new migration columns');

  const pdfCols = await pool.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name = 'pdfs' AND column_name IN (
      'predicted_subject_id', 'prediction_confidence', 'classification_status',
      'classification_model_version', 'classified_at', 'classification_source', 'manually_selected_subject_id'
    )
  `);
  assert.strictEqual(pdfCols.rows.length, 7, 'pdfs table should contain all 7 new classification columns');
  console.log('  ✔ PostgreSQL database schema verified: all 11 columns exist.\n');

  // Test 8: Admin ML Metrics API & Authorization
  console.log('Test 8: Verify GET /api/admin/ml/metrics security & payload...');
  const server = app.listen(0);
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}`;
  const secret = process.env.SESSION_SECRET || "studyreader-production-session-secret-k281x";

  const studentSid = `test-student-ml-${Date.now()}`;
  const adminSid = `test-admin-ml-${Date.now()}`;

  try {
    // 8a. Unauthenticated request (must be 401)
    const unauthRes = await fetch(`${baseUrl}/api/admin/ml/metrics`);
    assert.strictEqual(unauthRes.status, 401, 'Unauthenticated access must return 401');

    // 8b. Student session (must be 403)
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [studentSid, JSON.stringify({ cookie: {}, userId: '3' })]
    );
    const studentCookie = 's:' + cookieSignature.sign(studentSid, secret);
    const studentRes = await fetch(`${baseUrl}/api/admin/ml/metrics`, {
      headers: { Cookie: `connect.sid=${encodeURIComponent(studentCookie)}` }
    });
    assert.strictEqual(studentRes.status, 403, 'Student access must be rejected with 403');

    // 8c. Admin session (must be 200)
    await pool.query(
      `INSERT INTO sessions (sid, sess, expire) VALUES ($1, $2, NOW() + INTERVAL '1 hour')`,
      [adminSid, JSON.stringify({ cookie: {}, userId: '2' })]
    );
    const adminCookie = 's:' + cookieSignature.sign(adminSid, secret);
    const adminRes = await fetch(`${baseUrl}/api/admin/ml/metrics`, {
      headers: { Cookie: `connect.sid=${encodeURIComponent(adminCookie)}` }
    });
    assert.strictEqual(adminRes.status, 200, 'Admin access must return 200');

    const adminBody = await adminRes.json();
    assert.strictEqual(adminBody.success, true);
    assert.strictEqual(adminBody.model.name, 'Logistic Regression');
    assert.strictEqual(adminBody.model.status, 'Active');
    assert.strictEqual(adminBody.model.classesCount, 15);
    assert.ok(adminBody.evaluation, 'Evaluation metrics artifact must be present');
    assert.ok(adminBody.evaluation.models_comparison.logistic_regression.accuracy > 0.95);
    assert.ok(adminBody.operations, 'Operational stats must be present');
    console.log(`  ✔ Unauthenticated rejected (401), Student forbidden (403), Admin authorized (200).`);
    console.log(`  ✔ Returned model: ${adminBody.model.name} v${adminBody.model.version}, Accuracy: ${(adminBody.evaluation.models_comparison.logistic_regression.accuracy * 100).toFixed(2)}%\n`);
  } finally {
    await pool.query(`DELETE FROM sessions WHERE sid IN ($1, $2)`, [studentSid, adminSid]);
    server.close();
  }

  console.log('======================================================');
  console.log('\x1b[32m✔ ALL 8 TESTS PASSED SUCCESSFULLY!\x1b[0m');
  console.log('======================================================\n');
}

runTests()
  .catch((err) => {
    console.error('\x1b[31m✖ Test failed:\x1b[0m', err);
    process.exit(1);
  })
  .finally(async () => {
    if (jobProcessor) jobProcessor.stopWorker();
    await pool.end();
    process.exit(0);
  });
